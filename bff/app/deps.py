"""Application services container and FastAPI dependencies.

Everything expensive — the Firestore client, the KMS-backed token envelope, the
OIDC discovery cache, the outbound httpx clients — is built once per process in
``Services.create()`` and torn down in ``Services.aclose()``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Annotated, Any

import httpx
from fastapi import Depends, HTTPException, Request, status

from app.auth.cookies import read_session_cookie
from app.config import Settings, get_settings
from app.secrets.manager import SecretsManager
from app.session.cache import TTLCache
from app.session.crypto import TokenEnvelope, build_envelope
from app.session.lifecycle import LoadedSession, SessionExpired, SessionManager
from app.session.store import SessionStore, SessionStoreUnavailable, build_store

if TYPE_CHECKING:  # pragma: no cover
    from app.auth.oidc import OidcClient

logger = logging.getLogger(__name__)


@dataclass
class Services:
    settings: Settings
    secrets: SecretsManager
    store: SessionStore
    envelope: TokenEnvelope
    cache: TTLCache[Any]
    http: httpx.AsyncClient
    upstream_http: httpx.AsyncClient
    oidc: OidcClient | None = None
    sessions: SessionManager | None = None
    ready_errors: list[str] = field(default_factory=list)

    @classmethod
    async def create(cls, settings: Settings | None = None) -> Services:
        settings = settings or get_settings()

        secrets = SecretsManager.from_settings(settings)

        # AUTH_MODE=dev with neither an emulator nor a project runs entirely
        # in-process, so a developer needs no GCP credentials at all.
        in_memory = (
            settings.is_dev_auth
            and not settings.use_firestore_emulator
            and not settings.gcp_project_id
        )
        store = build_store(
            project_id=settings.gcp_project_id,
            database=settings.firestore_database,
            timeout_seconds=settings.firestore_timeout_seconds,
            breaker_threshold=settings.firestore_breaker_threshold,
            breaker_reset_seconds=settings.firestore_breaker_reset_seconds,
            in_memory=in_memory,
        )

        envelope = build_envelope(
            kms_key_name=settings.kms_key_name,
            allow_local=settings.environment != "prod",
        )

        cache: TTLCache[Any] = TTLCache(ttl_seconds=settings.session_cache_ttl_seconds)

        http = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.entra_http_timeout_seconds),
            follow_redirects=False,
        )
        upstream_http = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.upstream_timeout_seconds, connect=10.0),
            follow_redirects=False,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )

        services = cls(
            settings=settings,
            secrets=secrets,
            store=store,
            envelope=envelope,
            cache=cache,
            http=http,
            upstream_http=upstream_http,
        )

        # Imported here to keep the module graph acyclic.
        from app.auth.oidc import OidcClient

        if settings.auth_mode == "entra":
            services.oidc = OidcClient(settings=settings, http=http, secrets=secrets)

        services.sessions = SessionManager(
            settings=settings,
            store=store,
            envelope=envelope,
            cache=cache,
            oidc=services.oidc,
        )

        await services._preload_secrets()
        return services

    async def _preload_secrets(self) -> None:
        """Fetch required secrets at startup so /readyz can assert on them."""
        wanted: list[str] = []
        if self.settings.auth_mode == "entra":
            wanted.append(self.settings.entra_client_secret_name)
        if self.settings.upstream_mode == "apigee":
            wanted.append(self.settings.apigee_api_key_secret)
        if not wanted:
            return
        try:
            await self.secrets.preload(wanted)
        except Exception as exc:  # noqa: BLE001 - surfaced through /readyz
            self.ready_errors.append(f"secrets: {exc}")
            logger.error("secret_preload_failed", extra={"error": str(exc)})

    async def aclose(self) -> None:
        await self.http.aclose()
        await self.upstream_http.aclose()
        await self.store.close()


def get_services(request: Request) -> Services:
    services: Services | None = getattr(request.app.state, "services", None)
    if services is None:  # pragma: no cover - only if the lifespan did not run
        raise RuntimeError("Services are not initialised; the app lifespan did not run")
    return services


ServicesDep = Annotated[Services, Depends(get_services)]


def get_session_manager(services: ServicesDep) -> SessionManager:
    assert services.sessions is not None  # noqa: S101 - always built in create()
    return services.sessions


SessionManagerDep = Annotated["SessionManager", Depends(get_session_manager)]


# ── get_session (task 20) ────────────────────────────────────────────────────


async def get_session(request: Request, services: ServicesDep) -> LoadedSession:
    """Resolve the session cookie, or raise the *correct* error.

    The distinction this dependency exists to preserve (docs 13 §4):

    * no/expired/forged cookie  -> **401**, cookie cleared, SPA redirects to login
    * Firestore or Entra broken -> **503** + ``Retry-After``, SPA retries with backoff

    Collapsing these turns an outage into a redirect-to-login storm.
    """
    manager = get_session_manager(services)
    session_id = read_session_cookie(request.cookies)

    try:
        loaded = await manager.load(session_id)
        loaded = await manager.ensure_fresh_access_token(loaded)
    except SessionExpired as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthenticated", "reason": exc.reason},
            headers={"Cache-Control": "no-store"},
        ) from exc
    except SessionStoreUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "unavailable"},
            headers={"Retry-After": str(exc.retry_after), "Cache-Control": "no-store"},
        ) from exc

    if loaded.cookie_needs_update and loaded.rotated_to:
        # Picked up by RotatedSessionCookieMiddleware, which also covers the
        # streaming proxy responses that never merge dependency headers.
        request.scope.setdefault("state", {})["rotated_session_id"] = loaded.rotated_to

    request.scope.setdefault("state", {})["session_oid"] = loaded.record.subject_oid
    return loaded


SessionDep = Annotated["LoadedSession", Depends(get_session)]


async def get_csrf_checked_session(request: Request, session: SessionDep) -> LoadedSession:
    """``get_session`` plus CSRF enforcement for mutating verbs (gap G21)."""
    from app.auth import csrf

    try:
        csrf.enforce(request, session.record.csrf_token)
    except csrf.CsrfError as exc:
        logger.warning("csrf_rejected", extra={"reason": exc.reason, "path": request.url.path})
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "csrf", "reason": exc.reason},
        ) from exc
    return session


CsrfSessionDep = Annotated["LoadedSession", Depends(get_csrf_checked_session)]


def require_roles(*required: str) -> Any:
    """Role gate for a route.

    Note that Apigee remains the authority for authorisation (runbook §19.4:
    "Those stay in Apigee... or you have two places to keep in sync"). This is a
    UX guard that returns a clean 403 instead of letting the request travel to
    the gateway to be refused there.
    """

    async def _dependency(session: SessionDep) -> LoadedSession:
        held = set(session.record.roles)
        if not held.intersection(required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "forbidden", "requiredAnyOf": list(required)},
            )
        return session

    return Depends(_dependency)
