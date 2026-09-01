"""FastAPI application factory.

Decision D1: one container, one Cloud Run service. This process serves the built
SPA *and* ``/auth/*`` *and* ``/api/*`` from a single origin, which is what makes
the ``__Host-`` cookie prefix legal and removes CORS entirely.

Route order matters: the SPA catch-all is mounted last and explicitly refuses to
shadow ``/api``, ``/auth``, ``/healthz`` or ``/readyz``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import HTTPException
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response

from app.auth.cookies import RotatedSessionCookieMiddleware, clear_session_cookie
from app.auth.routes import router as auth_router
from app.config import Settings, get_settings
from app.deps import Services
from app.observability.logging import RequestLogMiddleware, configure_logging
from app.observability.security_headers import SecurityHeadersMiddleware, build_csp
from app.proxy.routes import router as proxy_router
from app.uploads.routes import router as uploads_router

logger = logging.getLogger(__name__)

RESERVED_PREFIXES = ("api/", "auth/", "healthz", "readyz", "docs", "openapi.json", "redoc")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    services = await Services.create(settings)
    app.state.services = services
    logger.info(
        "bff_started",
        extra={
            "environment": settings.environment,
            "authMode": settings.auth_mode,
            "upstreamMode": settings.upstream_mode,
            "downstreamAuthMode": settings.downstream_auth_mode,
            "uploadMode": settings.translation_upload_mode,
            "iapEnabled": settings.iap_enabled,
        },
    )
    try:
        yield
    finally:
        await services.aclose()
        logger.info("bff_stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="AI Hub BFF",
        version="0.1.0",
        lifespan=lifespan,
        # The OpenAPI UI is not part of the product surface and would need its own
        # CSP exemptions for inline scripts.
        docs_url="/docs" if settings.environment == "dev" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.environment == "dev" else None,
    )
    app.state.settings = settings

    # Middleware runs bottom-up on the way in, top-down on the way out.
    app.add_middleware(
        SecurityHeadersMiddleware,
        hsts_max_age=settings.hsts_max_age_seconds,
        csp=build_csp(
            connect_src_extra=settings.csp_connect_src_extra,
            is_dev=settings.environment == "dev",
        ),
        report_only=settings.csp_report_only,
        # HSTS on plain http in local dev would pin the browser to https://localhost.
        enable_hsts=settings.environment != "dev",
    )
    app.add_middleware(
        RotatedSessionCookieMiddleware, max_age=settings.session_absolute_ttl_seconds
    )
    app.add_middleware(RequestLogMiddleware)

    _register_exception_handlers(app)

    app.include_router(auth_router)
    app.include_router(uploads_router)
    app.include_router(proxy_router)
    _register_health(app)
    _register_spa(app, settings)

    return app


def _register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def _http_exception(request: Request, exc: HTTPException) -> Response:
        detail: Any = exc.detail
        payload = detail if isinstance(detail, dict) else {"error": str(detail)}
        response = JSONResponse(payload, status_code=exc.status_code, headers=exc.headers)
        # A 401 always means "your cookie is no good"; drop it so the browser
        # stops replaying it. 503 deliberately leaves it alone.
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            clear_session_cookie(response)
        return response


def _register_health(app: FastAPI) -> None:
    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> Response:
        """Liveness. Deliberately has no dependencies — it must not fail when
        Firestore does, or Cloud Run will restart healthy instances during an
        outage."""
        return PlainTextResponse("ok", headers={"Cache-Control": "no-store"})

    @app.get("/readyz", include_in_schema=False)
    async def readyz(request: Request) -> Response:
        services: Services | None = getattr(request.app.state, "services", None)
        if services is None:
            return JSONResponse(
                {"ready": False, "reason": "starting"},
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        problems = list(services.ready_errors)
        try:
            await services.store.ping()
        except Exception as exc:  # noqa: BLE001
            problems.append(f"sessionStore: {exc}")

        if problems:
            return JSONResponse(
                {"ready": False, "problems": problems},
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                headers={"Retry-After": "5", "Cache-Control": "no-store"},
            )
        return JSONResponse(
            {
                "ready": True,
                "secretsLoaded": services.secrets.loaded_names(),
                "authMode": services.settings.auth_mode,
                "upstreamMode": services.settings.upstream_mode,
            },
            headers={"Cache-Control": "no-store"},
        )


def _register_spa(app: FastAPI, settings: Settings) -> None:
    """Serve ``frontend/dist`` with an index.html fallback for client routes."""
    if not settings.serve_spa:
        return

    dist = Path(settings.spa_dist_dir).resolve()
    index = dist / "index.html"

    # The bundle is baked into the image and never changes at runtime, so the
    # file list is built once. This also removes any path-traversal question:
    # only paths present in this set are ever served.
    assets: dict[str, Path] = {}
    if dist.is_dir():
        for candidate in dist.rglob("*"):
            if candidate.is_file():
                assets[candidate.relative_to(dist).as_posix()] = candidate
    index_exists = index.is_file()
    logger.info("spa_bundle_indexed", extra={"distDir": str(dist), "fileCount": len(assets)})

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> Response:
        if full_path.startswith(RESERVED_PREFIXES):
            # Reached only when no /api or /auth route matched, i.e. a genuine 404.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")

        if not index_exists:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="UI bundle not built"
            )

        target = assets.get(full_path)
        if target is not None:
            # Vite emits content-hashed filenames under /assets, so they are
            # immutable; everything else must be revalidated.
            cache = (
                "public, max-age=31536000, immutable"
                if full_path.startswith("assets/")
                else "no-cache"
            )
            return FileResponse(target, headers={"Cache-Control": cache})

        # Unknown path: hand back the shell so the client router can resolve it.
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def _build_default_app() -> FastAPI:
    settings = get_settings()
    if not settings.spa_dist_dir or settings.spa_dist_dir == "/srv/static":
        # Allow running from a source checkout without setting SPA_DIST_DIR.
        local = Path(__file__).resolve().parents[2] / "frontend" / "dist"
        if local.is_dir() and not Path(settings.spa_dist_dir).is_dir():
            os.environ.setdefault("SPA_DIST_DIR", str(local))
            get_settings.cache_clear()
            settings = get_settings()
    return create_app(settings)


app = _build_default_app()
