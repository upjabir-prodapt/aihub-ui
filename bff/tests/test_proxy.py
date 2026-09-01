"""Proxy behaviour: header trust, CSRF, role gating (plan §11, gap G21)."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.config import Settings
from app.proxy.apigee import ApigeeHeaderInjector
from app.proxy.upstream import filter_request_headers, filter_response_headers
from app.secrets.manager import SecretsManager
from app.session.model import SessionRecord, utcnow
from tests.conftest import BASE_URL, same_origin_headers

# ── Header filtering ─────────────────────────────────────────────────────────


def test_client_supplied_colt_headers_are_stripped() -> None:
    """docs 11 §7.6: the whole trust chain is "any x-colt-* came from Apigee"."""
    filtered = filter_request_headers(
        {
            "x-colt-user-oid": "attacker-chosen-oid",
            "X-Colt-User-Roles": "Platform.Admin",
            "x-colt-business-unit": "anything",
            "Accept": "application/json",
        }
    )
    assert filtered == {"Accept": "application/json"}


def test_serverless_authorization_is_never_forwarded() -> None:
    """Runbook §20.7: "Never construct it in a caller.\""""
    filtered = filter_request_headers(
        {"X-Serverless-Authorization": "Bearer forged", "Accept": "*/*"}
    )
    assert "X-Serverless-Authorization" not in filtered


def test_client_credentials_are_not_forwarded_upstream() -> None:
    filtered = filter_request_headers(
        {
            "Cookie": "__Host-AISESSION=secret",
            "Authorization": "Bearer client-token",
            "X-CSRF-Token": "abc",
            "x-goog-iap-jwt-assertion": "assertion",
            "Content-Type": "application/json",
        }
    )
    assert filtered == {"Content-Type": "application/json"}


def test_hop_by_hop_headers_are_stripped_both_ways() -> None:
    assert filter_request_headers({"Connection": "keep-alive", "TE": "trailers"}) == {}
    assert filter_response_headers({"Transfer-Encoding": "chunked", "ETag": "x"}) == {"ETag": "x"}


def test_upstream_set_cookie_is_not_relayed_to_the_browser() -> None:
    """An upstream must not be able to set cookies on our origin."""
    assert "Set-Cookie" not in filter_response_headers({"Set-Cookie": "evil=1"})


# ── Injected headers ─────────────────────────────────────────────────────────


def a_record(**overrides: Any) -> SessionRecord:
    now = utcnow()
    base: dict[str, Any] = {
        "doc_id": "a" * 64,
        "subject_oid": "oid-123",
        "email": "person@colt.net",
        "name": "A Person",
        "tid": "tenant-1",
        "roles": ["Translation.User"],
        "csrf_token": "csrf",
        "created_at": now,
        "access_issued_at": now,
        "access_expires_at": now,
        "absolute_expires_at": now,
        "idle_expires_at": now,
        "last_seen_at": now,
        "department": "AI CoE",
        "company_name": "Colt Technology Services",
        "access_token": "the-entra-access-token",
    }
    base.update(overrides)
    return SessionRecord(**base)


async def test_injected_headers_are_all_server_derived(settings: Settings) -> None:
    injector = ApigeeHeaderInjector(
        settings=settings, secrets=SecretsManager.from_settings(settings)
    )
    headers = await injector.headers_for(a_record())

    assert headers["Authorization"] == "Bearer the-entra-access-token"
    assert headers[settings.apigee_user_oid_header] == "oid-123"
    assert headers["x-colt-user-email"] == "person@colt.net"
    assert headers["x-colt-user-roles"] == "Translation.User"
    assert headers["x-colt-user-department"] == "AI CoE"
    # docs 19 §3.4: the header exists here, but Apigee's AssignMessage policy
    # must be updated to relay it or it is silently dropped downstream.
    assert headers["x-colt-user-company"] == "Colt Technology Services"


async def test_absent_graph_fields_are_omitted_rather_than_sent_empty(
    settings: Settings,
) -> None:
    injector = ApigeeHeaderInjector(
        settings=settings, secrets=SecretsManager.from_settings(settings)
    )
    headers = await injector.headers_for(a_record(department=None, company_name=None))
    assert "x-colt-user-department" not in headers
    assert "x-colt-user-company" not in headers


# ── Authentication on the proxy ──────────────────────────────────────────────


async def test_proxy_requires_a_session(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/translation/v1/jobs")
    assert response.status_code == 401


async def test_proxy_serves_a_signed_in_user(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.get("/api/translation/v1/jobs")
    assert response.status_code == 200
    assert len(response.json()["jobs"]) == 4


# ── CSRF (gap G21) ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "headers",
    [
        pytest.param({}, id="no-origin-no-token"),
        pytest.param({"Origin": BASE_URL}, id="origin-but-no-token"),
        pytest.param(
            {"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"},
            id="foreign-origin",
        ),
    ],
)
async def test_mutating_request_without_valid_csrf_is_rejected(
    client: httpx.AsyncClient, signed_in: dict[str, object], headers: dict[str, str]
) -> None:
    response = await client.post(
        "/api/translation/v1/reviews/trans-job-8901",
        json={"rating": 5},
        headers=headers,
    )
    assert response.status_code == 403
    assert response.json()["error"] == "csrf"


async def test_mutating_request_with_a_wrong_csrf_token_is_rejected(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/api/translation/v1/reviews/trans-job-8901",
        json={"rating": 5},
        headers=same_origin_headers("not-the-right-token"),
    )
    assert response.status_code == 403


async def test_cross_site_form_post_with_a_valid_cookie_is_rejected(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    """Spike S2: the classic CSRF shape — valid cookie, hostile page."""
    response = await client.post(
        "/api/translation/v1/reviews/trans-job-8901",
        data={"rating": "5"},
        headers={
            "Origin": "https://evil.example",
            "Sec-Fetch-Site": "cross-site",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    assert response.status_code == 403


async def test_mutating_request_with_valid_csrf_succeeds(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/api/translation/v1/reviews/trans-job-8901",
        json={"rating": 5, "comment": "Accurate."},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    assert response.status_code == 201
    assert response.json()["rating"] == 5


async def test_safe_methods_need_no_csrf_token(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    assert (await client.get("/api/sales/v1/research/jobs")).status_code == 200


# ── Role gating ──────────────────────────────────────────────────────────────


async def test_proxy_refuses_a_service_the_user_has_no_role_for(
    client: httpx.AsyncClient, settings: Settings, store: Any, services: Any
) -> None:
    await client.get("/auth/login?return_to=/")
    session = (await client.get("/auth/session")).json()

    # Strip the sales roles from the live session.
    from app.config import SESSION_COOKIE_NAME
    from app.session.model import hash_session_id

    doc_id = hash_session_id(client.cookies[SESSION_COOKIE_NAME])
    await store.update(doc_id, {"roles": ["Translation.User"]})

    denied = await client.get("/api/sales/v1/research/jobs")
    allowed = await client.get("/api/translation/v1/jobs")

    assert denied.status_code == 403
    assert denied.json()["error"] == "forbidden"
    assert allowed.status_code == 200
    assert session["csrfToken"]
