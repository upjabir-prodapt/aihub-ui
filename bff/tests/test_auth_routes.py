"""HTTP behaviour of ``/auth/*`` and the status codes the SPA depends on."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx

from app.config import SESSION_COOKIE_NAME
from app.deps import Services
from app.session.model import hash_session_id
from app.session.store import InMemorySessionStore, SessionStoreUnavailable
from tests.conftest import BASE_URL, same_origin_headers

# ── /auth/session ────────────────────────────────────────────────────────────


async def test_session_without_cookie_is_401(client: httpx.AsyncClient) -> None:
    response = await client.get("/auth/session")
    assert response.status_code == 401
    assert response.json()["error"] == "unauthenticated"


async def test_session_returns_the_documented_payload(signed_in: dict[str, object]) -> None:
    """Plan §8: `{ email, name, department, companyName, roles[], csrfToken }`."""
    assert set(signed_in) >= {
        "email",
        "name",
        "department",
        "companyName",
        "roles",
        "csrfToken",
    }
    assert signed_in["email"] == "dev@colt.net"
    assert signed_in["roles"] == ["Translation.User", "Sales.User"]
    assert signed_in["csrfToken"]


async def test_session_is_never_cached(client: httpx.AsyncClient) -> None:
    response = await client.get("/auth/session")
    assert response.headers["cache-control"] == "no-store"


async def test_store_outage_yields_503_with_retry_after_not_401(
    client: httpx.AsyncClient, signed_in: dict[str, object], store: InMemorySessionStore
) -> None:
    """The single most important status-code distinction in the whole BFF."""
    store.fail_with = SessionStoreUnavailable("firestore down", retry_after=7)

    response = await client.get("/auth/session")

    assert response.status_code == 503
    assert response.headers["retry-after"] == "7"
    # And critically: the cookie is left alone, so the browser can retry.
    assert "set-cookie" not in response.headers


async def test_forged_cookie_is_rejected_and_cleared(client: httpx.AsyncClient) -> None:
    """Gap G21: a forged session cookie is rejected."""
    client.cookies.set(SESSION_COOKIE_NAME, "forged-value", domain="aihub.test")

    response = await client.get("/auth/session")

    assert response.status_code == 401
    assert "max-age=0" in response.headers.get("set-cookie", "").lower()


# ── cookie attributes ────────────────────────────────────────────────────────


async def test_session_cookie_has_the_required_attributes(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/auth/login?return_to=/tracker")
    set_cookie = response.headers["set-cookie"]

    assert set_cookie.startswith(SESSION_COOKIE_NAME + "=")
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "Path=/" in set_cookie
    # `Strict` drops the cookie on the return leg of the Entra redirect and
    # presents as an endless sign-in loop (docs 15 §B.10 #18).
    assert "SameSite=lax" in set_cookie.replace("SameSite=Lax", "SameSite=lax")
    # `__Host-` forbids a Domain attribute.
    assert "Domain=" not in set_cookie


# ── return_to validation ─────────────────────────────────────────────────────


async def test_login_honours_a_relative_return_to(client: httpx.AsyncClient) -> None:
    response = await client.get("/auth/login?return_to=/translation")
    assert response.status_code == 302
    assert response.headers["location"] == "/translation"


async def test_login_refuses_an_open_redirect(client: httpx.AsyncClient) -> None:
    for hostile in ("https://evil.example/x", "//evil.example/x", "/auth/callback"):
        response = await client.get(f"/auth/login?return_to={hostile}")
        assert response.headers["location"] == "/", hostile


# ── logout ───────────────────────────────────────────────────────────────────


async def test_logout_clears_the_cookie_and_deletes_the_document(
    client: httpx.AsyncClient, signed_in: dict[str, object], store: InMemorySessionStore
) -> None:
    session_id = client.cookies[SESSION_COOKIE_NAME]
    doc_id = hash_session_id(session_id)
    assert await store.get(doc_id) is not None

    response = await client.post(
        "/auth/logout", headers=same_origin_headers(str(signed_in["csrfToken"]))
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    # Deleted, not marked expired (docs 13 §1 step 2).
    assert await store.get(doc_id) is None
    assert "max-age=0" in response.headers["set-cookie"].lower()


async def test_logout_is_idempotent(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    headers = same_origin_headers(str(signed_in["csrfToken"]))
    first = await client.post("/auth/logout", headers=headers)
    second = await client.post("/auth/logout", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200


async def test_logout_without_csrf_token_is_rejected(
    client: httpx.AsyncClient, signed_in: dict[str, object], store: InMemorySessionStore
) -> None:
    """A GET-reachable or CSRF-free logout is itself a CSRF vector (docs 13 §1)."""
    session_id = client.cookies[SESSION_COOKIE_NAME]

    response = await client.post("/auth/logout", headers={"Origin": BASE_URL})

    assert response.status_code == 403
    assert await store.get(hash_session_id(session_id)) is not None


async def test_logout_from_a_foreign_origin_is_rejected(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/auth/logout",
        headers={
            "X-CSRF-Token": str(signed_in["csrfToken"]),
            "Origin": "https://evil.example",
            "Sec-Fetch-Site": "cross-site",
        },
    )
    assert response.status_code == 403


async def test_logout_is_not_reachable_by_get(
    client: httpx.AsyncClient, signed_in: dict[str, object], store: InMemorySessionStore
) -> None:
    """docs 13 §1: a GET-reachable logout is forbidden.

    A front-channel logout URL misregistered on this path is the likely source of
    such a GET, so the response must name the correct path — otherwise the
    misconfiguration is invisible: Entra's hidden iframe swallows the 405 and the
    only symptom is a session outliving the sign-out.
    """
    session_id = client.cookies[SESSION_COOKIE_NAME]

    response = await client.get("/auth/logout")

    assert response.status_code == 405
    assert response.headers["allow"] == "POST"
    assert "/auth/frontchannel-logout" in response.json()["detail"]
    # And it must not double as a logout: nothing is terminated.
    assert await store.get(hash_session_id(session_id)) is not None


# ── front-channel logout ─────────────────────────────────────────────────────


async def test_frontchannel_logout_needs_no_csrf_and_kills_matching_sessions(
    client: httpx.AsyncClient, signed_in: dict[str, object], store: InMemorySessionStore
) -> None:
    """Entra invokes this as a browser GET in a hidden iframe, so no CSRF."""
    session_id = client.cookies[SESSION_COOKIE_NAME]
    doc_id = hash_session_id(session_id)
    # AUTH_MODE=dev mints sessions with no Entra sid, so set one to match on.
    await store.update(doc_id, {"entra_sid": "sid-abc"})

    response = await client.get("/auth/frontchannel-logout?sid=sid-abc")

    assert response.status_code == 204
    assert await store.get(doc_id) is None


async def test_frontchannel_logout_without_sid_is_a_no_op(
    client: httpx.AsyncClient, signed_in: dict[str, object], store: InMemorySessionStore
) -> None:
    session_id = client.cookies[SESSION_COOKIE_NAME]
    response = await client.get("/auth/frontchannel-logout")

    assert response.status_code == 204
    assert await store.get(hash_session_id(session_id)) is not None


# ── rotation over HTTP ───────────────────────────────────────────────────────


async def test_rotation_emits_the_successor_cookie_on_a_proxied_request(
    client: httpx.AsyncClient,
    signed_in: dict[str, object],
    store: InMemorySessionStore,
    services: Services,
) -> None:
    """The successor cookie must reach the browser even on a streaming response."""
    original = client.cookies[SESSION_COOKIE_NAME]
    doc_id = hash_session_id(original)

    # Force the token overdue so the next request refreshes and rotates.
    now = datetime.now(UTC)
    await store.update(
        doc_id,
        {
            "access_issued_at": now - timedelta(seconds=990),
            "access_expires_at": now + timedelta(seconds=10),
        },
    )

    class RotatingOidc:
        async def refresh(self, refresh_token: str) -> object:
            from app.auth.oidc import TokenSet

            return TokenSet(
                access_token="rotated-access",
                refresh_token="rotated-refresh",
                id_token="",
                expires_in=3600,
            )

        async def roles_from_access_token(self, access_token: str) -> list[str]:
            return ["Translation.User", "Sales.User"]

    assert services.sessions is not None
    services.sessions._oidc = RotatingOidc()  # type: ignore[assignment]  # noqa: SLF001

    response = await client.get("/api/translation/v1/jobs")

    assert response.status_code == 200
    set_cookie = response.headers.get("set-cookie", "")
    assert SESSION_COOKIE_NAME in set_cookie
    assert original not in set_cookie, "the cookie should have changed"


# ── health ───────────────────────────────────────────────────────────────────


async def test_healthz_has_no_dependencies(
    client: httpx.AsyncClient, store: InMemorySessionStore
) -> None:
    """Liveness must not fail when Firestore does, or Cloud Run restarts
    healthy instances during an outage."""
    store.fail_with = SessionStoreUnavailable("down")
    response = await client.get("/healthz")
    assert response.status_code == 200


async def test_readyz_fails_when_the_store_is_unreachable(
    client: httpx.AsyncClient, store: InMemorySessionStore
) -> None:
    assert (await client.get("/readyz")).status_code == 200

    store.fail_with = SessionStoreUnavailable("down")
    response = await client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["ready"] is False
