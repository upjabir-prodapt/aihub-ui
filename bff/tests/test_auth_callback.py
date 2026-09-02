"""``/auth/callback`` under ``AUTH_MODE=entra``.

The behaviour pinned here is the two-token split. An access token has exactly
one audience, so the token used for the platform API cannot also call Microsoft
Graph: the callback performs a *second* refresh-token exchange for Graph, and
must carry the rotated refresh token from that exchange into the session or the
session dies at the first renewal.
"""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import httpx
import pytest

from app.auth.oidc import OidcError, Principal, TokenSet
from app.config import SESSION_COOKIE_NAME, Settings
from app.deps import Services
from app.main import create_app
from app.session.crypto import LocalKeyWrapper, TokenEnvelope
from app.session.model import AuthState, hash_session_id, utcnow
from app.session.store import InMemorySessionStore
from tests.conftest import BASE_URL

TENANT = "11111111-1111-1111-1111-111111111111"
API_CLIENT_ID = "22222222-2222-2222-2222-222222222222"
APP_ID_URI = f"api://{API_CLIENT_ID}"

STATE = "state-value"
NONCE = "nonce-value"

API_ACCESS_TOKEN = "api-access-token"  # audienced at AICOE-API-DEV
GRAPH_ACCESS_TOKEN = "graph-access-token"  # audienced at Microsoft Graph
ORIGINAL_REFRESH = "refresh-original"
ROTATED_REFRESH = "refresh-rotated-by-graph-exchange"


def entra_settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "environment": "dev",
        "auth_mode": "entra",
        "upstream_mode": "mock",
        "iap_enabled": False,
        "serve_spa": False,
        "translation_upload_mode": "multipart",
        "session_cache_ttl_seconds": 0,
        "entra_tenant_id": TENANT,
        "entra_client_id": "33333333-3333-3333-3333-333333333333",
        "entra_app_id_uri": APP_ID_URI,
        "entra_access_token_audiences": API_CLIENT_ID,
        "entra_redirect_uri": "https://aihub.test/auth/callback",
        "entra_scopes": f"openid profile offline_access {APP_ID_URI}/Translation.Translate",
        "gcp_project_id": "proj",
        # Declaring an emulator keeps KMS out of the picture: the envelope falls
        # back to the local key wrapper and no GCP client is ever constructed.
        "firestore_emulator_host": "localhost:8080",
    }
    return Settings(**{**base, **overrides})


class StubOidc:
    """Records what it was asked for so the test can assert on token routing."""

    def __init__(
        self,
        *,
        graph_tokens: TokenSet | None = None,
        principal_error: Exception | None = None,
    ) -> None:
        self.graph_tokens = graph_tokens
        self.principal_error = principal_error
        self.graph_exchange_calls: list[str] = []

    async def exchange_code(self, *, code: str, code_verifier: str) -> TokenSet:
        return TokenSet(
            access_token=API_ACCESS_TOKEN,
            refresh_token=ORIGINAL_REFRESH,
            id_token="id-token",
            expires_in=3600,
        )

    async def principal_from(self, tokens: TokenSet, *, expected_nonce: str) -> Principal:
        if self.principal_error is not None:
            raise self.principal_error
        return Principal(
            oid="44444444-4444-4444-4444-444444444444",
            email="user@colt.net",
            name="Test User",
            tid=TENANT,
            roles=["Translation.User"],
        )

    async def acquire_graph_token(self, refresh_token: str) -> TokenSet | None:
        self.graph_exchange_calls.append(refresh_token)
        return self.graph_tokens


class StubGraphHttp:
    """Stands in for the shared httpx client on the Graph call only."""

    def __init__(self) -> None:
        self.bearer_tokens: list[str] = []

    async def get(
        self,
        url: str,
        *,
        headers: dict[str, str],
        timeout: float,  # noqa: ASYNC109 - mirrors the httpx.AsyncClient.get signature
    ) -> httpx.Response:
        self.bearer_tokens.append(headers["Authorization"].removeprefix("Bearer "))
        return httpx.Response(
            200,
            json={"department": "AI CoE", "companyName": "Colt"},
            request=httpx.Request("GET", url),
        )

    async def aclose(self) -> None:
        """Services.aclose() closes the shared client; the stub replaces it."""


@pytest.fixture
async def entra_stack(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[dict[str, Any]]:
    settings = entra_settings()
    store = InMemorySessionStore()

    # No Firestore client, and the client secret comes from the env resolver.
    monkeypatch.setattr("app.deps.build_store", lambda **_kwargs: store)
    monkeypatch.setenv("DEV_SECRETS_FROM_ENV", "true")
    monkeypatch.setenv("DEV_SECRET_ENTRA_BFF_CLIENT_SECRET", "not-a-real-secret")

    services = await Services.create(settings)
    services.store = store
    assert services.sessions is not None
    services.sessions._store = store  # noqa: SLF001 - deliberate test seam
    services.sessions._envelope = TokenEnvelope(LocalKeyWrapper())  # noqa: SLF001

    app = create_app(settings)
    app.state.services = services

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as client:
        yield {"client": client, "services": services, "store": store, "settings": settings}

    await services.aclose()


async def seed_auth_state(store: InMemorySessionStore) -> None:
    now = utcnow()
    await store.put_auth_state(
        hashlib.sha256(STATE.encode("utf-8")).hexdigest(),
        AuthState(
            nonce=NONCE,
            pkce_verifier="verifier",
            return_to="/",
            created_at=now,
            expires_at=now + timedelta(seconds=600),
            interactive_retry=False,
        ),
    )


# ── the two-token split ──────────────────────────────────────────────────────


async def test_graph_is_called_with_the_graph_token_not_the_api_token(
    entra_stack: dict[str, Any],
) -> None:
    services = entra_stack["services"]
    graph_http = StubGraphHttp()
    services.oidc = StubOidc(
        graph_tokens=TokenSet(
            access_token=GRAPH_ACCESS_TOKEN,
            refresh_token=ROTATED_REFRESH,
            id_token="",
            expires_in=3600,
        )
    )
    services.http = graph_http
    await seed_auth_state(entra_stack["store"])

    response = await entra_stack["client"].get(f"/auth/callback?code=abc&state={STATE}")

    assert response.status_code == 302
    # The whole point: Graph must never see the API-audienced token.
    assert graph_http.bearer_tokens == [GRAPH_ACCESS_TOKEN]
    assert API_ACCESS_TOKEN not in graph_http.bearer_tokens
    # And the exchange must spend the refresh token from the code exchange.
    assert services.oidc.graph_exchange_calls == [ORIGINAL_REFRESH]


async def test_rotated_refresh_token_is_persisted(entra_stack: dict[str, Any]) -> None:
    """Entra rotates refresh tokens; storing the spent one kills the session
    at the first renewal, roughly an hour after sign-in."""
    services = entra_stack["services"]
    services.oidc = StubOidc(
        graph_tokens=TokenSet(
            access_token=GRAPH_ACCESS_TOKEN,
            refresh_token=ROTATED_REFRESH,
            id_token="",
            expires_in=3600,
        )
    )
    services.http = StubGraphHttp()
    store = entra_stack["store"]
    await seed_auth_state(store)

    response = await entra_stack["client"].get(f"/auth/callback?code=abc&state={STATE}")

    session_id = response.cookies[SESSION_COOKIE_NAME]
    record = await services.sessions.load(session_id)
    assert record.record.refresh_token == ROTATED_REFRESH


async def test_graph_failure_falls_open_and_keeps_the_original_refresh_token(
    entra_stack: dict[str, Any],
) -> None:
    """department/companyName are a reporting dimension, never a gate."""
    services = entra_stack["services"]
    services.oidc = StubOidc(graph_tokens=None)  # exchange failed
    graph_http = StubGraphHttp()
    services.http = graph_http
    store = entra_stack["store"]
    await seed_auth_state(store)

    response = await entra_stack["client"].get(f"/auth/callback?code=abc&state={STATE}")

    assert response.status_code == 302, "sign-in must still succeed"
    assert graph_http.bearer_tokens == [], "no Graph call without a Graph token"

    session_id = response.cookies[SESSION_COOKIE_NAME]
    loaded = await services.sessions.load(session_id)
    assert loaded.record.department == "Unknown Department"
    assert loaded.record.company_name == "Unknown Company"
    # The unspent refresh token must survive.
    assert loaded.record.refresh_token == ORIGINAL_REFRESH


async def test_session_document_exists_after_callback(entra_stack: dict[str, Any]) -> None:
    services = entra_stack["services"]
    services.oidc = StubOidc(
        graph_tokens=TokenSet(
            access_token=GRAPH_ACCESS_TOKEN,
            refresh_token=ROTATED_REFRESH,
            id_token="",
            expires_in=3600,
        )
    )
    services.http = StubGraphHttp()
    store = entra_stack["store"]
    await seed_auth_state(store)

    response = await entra_stack["client"].get(f"/auth/callback?code=abc&state={STATE}")

    session_id = response.cookies[SESSION_COOKIE_NAME]
    assert await store.get(hash_session_id(session_id)) is not None


# ── configuration errors are terminal, not silent ────────────────────────────


async def test_unvalidatable_access_token_renders_the_config_error_page(
    entra_stack: dict[str, Any],
) -> None:
    """A role-less session looks exactly like a group-assignment problem and is
    close to undiagnosable, so the sign-in fails instead."""
    services = entra_stack["services"]
    services.oidc = StubOidc(principal_error=OidcError("access_token validation failed"))
    services.http = StubGraphHttp()
    await seed_auth_state(entra_stack["store"])

    response = await entra_stack["client"].get(f"/auth/callback?code=abc&state={STATE}")

    assert response.status_code == 500
    body = response.text
    assert "ENTRA_ACCESS_TOKEN_AUDIENCES" in body
    assert "requestedAccessTokenVersion" in body
