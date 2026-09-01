"""Shared fixtures.

The suite runs against the in-memory ``SessionStore`` rather than the Firestore
emulator by default. The protocol (decision D4) is the whole point: the
lifecycle rules under test — expiry, lease, rotation, fail-closed — are the
BFF's, not Firestore's, and an in-memory store makes them deterministic and
lets a failure be injected precisely.

Set ``FIRESTORE_EMULATOR_HOST`` and run with ``-m emulator`` to exercise the
real ``FirestoreSessionStore`` against an emulator.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

os.environ.setdefault("ENVIRONMENT", "dev")
os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("UPSTREAM_MODE", "mock")
os.environ.setdefault("IAP_ENABLED", "false")
os.environ.setdefault("SERVE_SPA", "false")
os.environ.setdefault("TRANSLATION_UPLOAD_MODE", "multipart")
os.environ.setdefault("SESSION_CACHE_TTL_SECONDS", "0")
os.environ.setdefault("LOG_LEVEL", "WARNING")

from app.config import Settings, get_settings  # noqa: E402
from app.deps import Services  # noqa: E402
from app.main import create_app  # noqa: E402
from app.proxy.mock import reset_mock_state  # noqa: E402
from app.session.crypto import LocalKeyWrapper, TokenEnvelope  # noqa: E402
from app.session.store import InMemorySessionStore  # noqa: E402

BASE_URL = "https://aihub.test"


@pytest.fixture(autouse=True)
def _reset_mocks() -> None:
    reset_mock_state()


@pytest.fixture
def settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()


@pytest.fixture
def store() -> InMemorySessionStore:
    return InMemorySessionStore()


@pytest.fixture
def envelope() -> TokenEnvelope:
    return TokenEnvelope(LocalKeyWrapper())


@pytest.fixture
async def services(settings: Settings, store: InMemorySessionStore) -> AsyncIterator[Services]:
    built = await Services.create(settings)
    # Swap in the injectable store so tests can force failures.
    built.store = store
    assert built.sessions is not None
    built.sessions._store = store  # noqa: SLF001 - deliberate test seam
    try:
        yield built
    finally:
        await built.aclose()


@pytest.fixture
async def client(settings: Settings, services: Services) -> AsyncIterator[httpx.AsyncClient]:
    """An ASGI client with the app already started and services injected."""
    app = create_app(settings)
    app.state.services = services

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as http:
        yield http


@pytest.fixture
async def signed_in(client: httpx.AsyncClient) -> dict[str, Any]:
    """Mint a dev session and return the identity payload plus the CSRF token."""
    await client.get("/auth/login?return_to=/")
    response = await client.get("/auth/session")
    assert response.status_code == 200
    return dict(response.json())


def same_origin_headers(csrf_token: str) -> dict[str, str]:
    """Headers a real same-origin fetch from the SPA would send."""
    return {
        "X-CSRF-Token": csrf_token,
        "Origin": BASE_URL,
        "Sec-Fetch-Site": "same-origin",
    }
