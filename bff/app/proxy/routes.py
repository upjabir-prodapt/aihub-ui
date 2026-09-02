"""``/api/*`` proxy routes.

Every upstream call carries a live session (``get_session``), so a request with
no cookie gets 401 and a request during a Firestore outage gets 503 — the proxy
itself never has to reason about either.

Mutating verbs additionally require CSRF (gap G21). GET is exempt because a GET
must not change state; that is the third leg of the CSRF design in docs 11 §5.4.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import Response

from app.auth import csrf
from app.deps import ServicesDep, SessionDep
from app.proxy import mock
from app.proxy.apigee import ApigeeHeaderInjector
from app.proxy.upstream import StreamingProxy, UpstreamError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["proxy"])

Service = Literal["translation", "sales"]

# The proxy is a UX guard only; Apigee remains the authority (runbook §19.4).
SERVICE_ROLES: dict[str, tuple[str, ...]] = {
    "translation": ("Translation.User", "Platform.Admin"),
    "sales": ("SalesAgent.User", "Sales.User", "Platform.Admin"),
}


async def _proxy(
    service: Service,
    path: str,
    request: Request,
    services: ServicesDep,
    session: SessionDep,
) -> Response:
    record = session.record

    if csrf.is_mutating(request.method):
        try:
            csrf.enforce(request, record.csrf_token)
        except csrf.CsrfError as exc:
            logger.warning(
                "proxy_csrf_rejected", extra={"reason": exc.reason, "path": request.url.path}
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "csrf", "reason": exc.reason},
            ) from exc

    required = SERVICE_ROLES[service]
    if required and not set(record.roles).intersection(required):
        logger.warning(
            "proxy_role_denied",
            extra={
                "service": service,
                "oid": record.subject_oid,
                "sessionRoles": list(record.roles),
                "requiredAnyOf": list(required),
                "detail": "An empty sessionRoles list means the access token carried no "
                "roles[] claim -- an Entra App Role assignment problem, not a BFF "
                "one. Look for access_token_has_no_roles at sign-in.",
            },
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "forbidden", "requiredAnyOf": list(required)},
        )

    if services.settings.upstream_mode == "mock":
        return await mock.handle(service, path, request)

    injector = ApigeeHeaderInjector(settings=services.settings, secrets=services.secrets)
    base_url = injector.base_url_for(service)
    extra = await injector.headers_for(record)

    if services.settings.downstream_auth_mode == "colt_session":
        # Decision D3 shim. Confined to one module so it is trivial to delete.
        from app.proxy.colt_session import ColtSessionShim

        shim = ColtSessionShim(settings=services.settings, http=services.http)
        extra.update(await shim.headers_for(service=service, base_url=base_url, record=record))

    proxy = StreamingProxy(services.upstream_http)
    try:
        return await proxy.forward(
            request,
            url=f"{base_url}/{path.lstrip('/')}",
            extra_headers=extra,
            upstream_timeout=services.settings.upstream_timeout_seconds,
        )
    except UpstreamError as exc:
        logger.error(
            "upstream_error",
            extra={"service": service, "status": exc.status_code, "error": str(exc)},
        )
        raise HTTPException(
            status_code=exc.status_code, detail={"error": "upstream_unavailable"}
        ) from exc


@router.api_route(
    "/translation/v1/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def translation_proxy(
    path: str,
    request: Request,
    services: ServicesDep,
    session: SessionDep,
) -> Response:
    return await _proxy("translation", path, request, services, session)


@router.api_route(
    "/sales/v1/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def sales_proxy(
    path: str,
    request: Request,
    services: ServicesDep,
    session: SessionDep,
) -> Response:
    return await _proxy("sales", path, request, services, session)
