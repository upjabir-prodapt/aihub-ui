"""``/auth/*`` endpoints.

Flow, per plan §6:

    IAP assertion -> login_hint -> Entra authorize (prompt=none)
                  -> callback -> code exchange -> MS Graph -> Firestore session
                  -> __Host-AISESSION -> return_to

Two behaviours here are deliberate and easy to regress:

* ``prompt=none`` gets **exactly one** interactive retry. Anything else renders a
  terminal error page. An error path that redirects back to ``/auth/login`` is a
  redirect loop with a login screen in it.
* ``POST /auth/logout`` is CSRF-protected and ``GET /auth/frontchannel-logout``
  is not. They are separate paths on purpose: docs 13 §1 forbids a GET-reachable
  logout, but Entra invokes a front-channel logout URL as a browser GET. One
  handler cannot satisfy both, so there are two.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import timedelta
from typing import Annotated, Any
from urllib.parse import quote, urlencode, urlparse

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.auth import csrf
from app.auth.cookies import clear_session_cookie, read_session_cookie, set_session_cookie
from app.auth.graph import GraphClient
from app.auth.iap import IAP_ASSERTION_HEADER, IapValidationError, IapValidator
from app.auth.oidc import (
    InteractionRequiredError,
    OidcError,
    Principal,
    TokenSet,
    generate_pkce,
)
from app.deps import ServicesDep
from app.session.lifecycle import SessionExpired
from app.session.model import AuthState, utcnow
from app.session.store import SessionStoreUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── return_to validation ─────────────────────────────────────────────────────


def safe_return_to(candidate: str | None, *, default: str = "/") -> str:
    """Only same-origin relative paths. Anything else is an open redirect."""
    if not candidate:
        return default
    if not candidate.startswith("/") or candidate.startswith("//"):
        return default
    parsed = urlparse(candidate)
    if parsed.scheme or parsed.netloc:
        return default
    # Never bounce the browser back into the auth machinery.
    if parsed.path.startswith("/auth/"):
        return default
    return candidate


def _hash_state(state: str) -> str:
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def _terminal_error(
    request: Request, *, title: str, detail: str, status_code: int = 500
) -> Response:
    """A dead end, on purpose. No auto-redirect, no retry link into /auth/login."""
    request_id = getattr(request.state, "request_id", "-")
    body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{title}</title>
<meta name="robots" content="noindex">
<style>
 body{{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;
      min-height:100vh;background:#0f1115;color:#e6e8eb}}
 main{{max-width:34rem;padding:2rem}}
 h1{{font-size:1.25rem;margin:0 0 .75rem}}
 p{{margin:0 0 .75rem;color:#aab2bd}}
 code{{background:#1b1f27;padding:.15rem .35rem;border-radius:.25rem}}
</style></head>
<body><main>
<h1>{title}</h1>
<p>{detail}</p>
<p>Reference <code>{request_id}</code>. Please contact the AI CoE platform team
with this reference; retrying is unlikely to help.</p>
</main></body></html>"""
    return HTMLResponse(body, status_code=status_code, headers={"Cache-Control": "no-store"})


# ── AUTH_MODE=dev ────────────────────────────────────────────────────────────


async def _mint_dev_session(services: ServicesDep, response: Response) -> None:
    """Task 17: a fixed local session with configurable roles. No IAP, no Entra."""
    settings = services.settings
    assert services.sessions is not None  # noqa: S101
    principal = Principal(
        oid=settings.dev_session_oid,
        email=settings.dev_session_email,
        name=settings.dev_session_name,
        tid="dev-tenant",
        roles=settings.dev_roles,
        sid=None,
    )
    tokens = TokenSet(
        access_token=f"dev-access-{secrets.token_hex(8)}",
        refresh_token=f"dev-refresh-{secrets.token_hex(8)}",
        id_token="",
        expires_in=settings.session_absolute_ttl_seconds,
    )
    session_id, _ = await services.sessions.create(
        principal=principal,
        tokens=tokens,
        department=settings.dev_session_department,
        company_name=settings.dev_session_company,
    )
    set_session_cookie(response, session_id, max_age=settings.session_absolute_ttl_seconds)


# ── /auth/login ──────────────────────────────────────────────────────────────


@router.get("/login")
async def login(
    request: Request,
    services: ServicesDep,
    return_to: Annotated[str | None, Query(alias="return_to")] = None,
) -> Response:
    settings = services.settings
    target = safe_return_to(return_to)

    if settings.is_dev_auth:
        response = RedirectResponse(target, status_code=status.HTTP_302_FOUND)
        await _mint_dev_session(services, response)
        return response

    if services.oidc is None:  # pragma: no cover - guarded by config validation
        return _terminal_error(
            request,
            title="Sign-in is not configured",
            detail="This deployment has AUTH_MODE=entra but no OIDC client was built.",
        )

    # docs 15 §0.1: the hint must come from the validated assertion, never from
    # anything the browser supplies.
    validator = IapValidator(settings)
    try:
        identity = await validator.validate(request.headers.get(IAP_ASSERTION_HEADER))
    except IapValidationError as exc:
        logger.warning(
            "iap_validation_failed",
            extra={
                "error": str(exc),
                "assertionPresent": IAP_ASSERTION_HEADER in request.headers,
                "iapAudience": settings.iap_audience,
                "detail": "With IAP_ENABLED=true every request must arrive through the "
                "IAP-fronted load balancer. A missing assertion means the service was "
                "reached directly (e.g. the run.app URL) or the load balancer is not "
                "built yet; an invalid one usually means IAP_AUDIENCE is wrong.",
            },
        )
        return _terminal_error(
            request,
            title="Request did not come through the front door",
            detail="The Identity-Aware Proxy assertion is missing or invalid.",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    logger.info(
        "login_start",
        extra={
            "iapEnabled": settings.iap_enabled,
            "iapIdentityResolved": identity is not None,
            "loginHintEmail": identity.email if identity else None,
            "returnTo": target,
        },
    )
    return await _begin_authorize(
        services,
        login_hint=identity.email if identity else None,
        return_to=target,
        silent=True,
    )


async def _begin_authorize(
    services: ServicesDep,
    *,
    login_hint: str | None,
    return_to: str,
    silent: bool,
) -> Response:
    assert services.oidc is not None  # noqa: S101
    settings = services.settings

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier, challenge = generate_pkce()
    now = utcnow()

    await services.store.put_auth_state(
        _hash_state(state),
        AuthState(
            nonce=nonce,
            pkce_verifier=verifier,
            return_to=return_to,
            created_at=now,
            expires_at=now + timedelta(seconds=settings.auth_state_ttl_seconds),
            interactive_retry=not silent,
        ),
    )

    url = await services.oidc.authorization_url(
        state=state,
        nonce=nonce,
        code_challenge=challenge,
        login_hint=login_hint,
        silent=silent,
    )
    return RedirectResponse(
        url, status_code=status.HTTP_302_FOUND, headers={"Cache-Control": "no-store"}
    )


# ── /auth/callback ───────────────────────────────────────────────────────────


@router.get("/callback")
async def callback(  # noqa: C901 - a linear flow with explicit error branches
    request: Request,
    services: ServicesDep,
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
    error_description: Annotated[str | None, Query()] = None,
) -> Response:
    settings = services.settings
    logger.info(
        "callback_received",
        extra={
            "hasCode": bool(code),
            "hasState": bool(state),
            "entraError": error,
            "entraErrorDescription": error_description,
        },
    )
    if services.oidc is None or services.sessions is None:  # pragma: no cover
        return _terminal_error(
            request,
            title="Sign-in is not configured",
            detail="No OIDC client is available in this deployment.",
        )

    if not state:
        return _terminal_error(
            request,
            title="Sign-in could not be completed",
            detail="The response from Microsoft Entra ID carried no state parameter.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # Single-use: taking the document also deletes it.
    try:
        auth_state = await services.store.take_auth_state(_hash_state(state))
    except SessionStoreUnavailable:
        return _terminal_error(
            request,
            title="Sign-in is temporarily unavailable",
            detail="The session store could not be reached while completing sign-in.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    if auth_state is None or utcnow() >= auth_state.expires_at:
        return _terminal_error(
            request,
            title="Sign-in request expired",
            detail="This sign-in attempt is no longer valid. Close the tab and open the "
            "application again from your bookmark.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if error:
        # docs 15 §0.1: interaction_required / login_required get one interactive
        # retry. Everything else is terminal.
        from app.auth.oidc import INTERACTION_REQUIRED

        if error in INTERACTION_REQUIRED and not auth_state.interactive_retry:
            logger.info("silent_sso_fallback", extra={"entraError": error})
            return await _begin_authorize(
                services,
                login_hint=None,
                return_to=auth_state.return_to,
                silent=False,
            )
        logger.error(
            "entra_authorize_error",
            extra={"entraError": error, "entraErrorDescription": error_description},
        )
        return _terminal_error(
            request,
            title="Microsoft Entra ID refused the sign-in",
            detail=f"Entra returned <code>{error}</code>. "
            "This usually means an app registration or Conditional Access problem.",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    if not code:
        return _terminal_error(
            request,
            title="Sign-in could not be completed",
            detail="No authorization code was returned.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    try:
        tokens = await services.oidc.exchange_code(
            code=code, code_verifier=auth_state.pkce_verifier
        )
        principal = await services.oidc.principal_from(tokens, expected_nonce=auth_state.nonce)
    except InteractionRequiredError:
        if not auth_state.interactive_retry:
            return await _begin_authorize(
                services, login_hint=None, return_to=auth_state.return_to, silent=False
            )
        return _terminal_error(
            request,
            title="Microsoft Entra ID requires an interactive sign-in",
            detail="Entra asked for interaction twice in a row, which usually points at a "
            "Conditional Access sign-in-frequency policy on this application.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    except OidcError as exc:
        logger.error("code_exchange_failed", extra={"error": str(exc), "entraError": exc.code})
        return _terminal_error(
            request,
            title="Sign-in could not be completed",
            detail="The authorization code could not be exchanged for, or validated against, the "
            "app registration. Check that ENTRA_SCOPES names exactly one resource, that "
            "ENTRA_ACCESS_TOKEN_AUDIENCES matches the resource app's "
            "<code>requestedAccessTokenVersion</code> (v2 issues the client ID GUID as "
            "<code>aud</code>, v1 the App ID URI), and that all requested scopes exist on "
            "the app registration. See ENTRA_SETUP.md.",
        )

    # Graph is a different resource, so it needs its own access token: the one
    # above is audienced at the platform API and Graph would reject it. Decision
    # D6 / docs 19 Option A -- fail open, never let this abort sign-in.
    graph_client = GraphClient(settings=settings, http=services.http)
    graph_tokens = await services.oidc.acquire_graph_token(tokens.refresh_token)
    if graph_tokens is None:
        logger.warning("graph_profile_skipped_no_token")
        profile = graph_client.fallback_profile()
    else:
        # Entra rotates refresh tokens. The one we just spent may no longer be
        # redeemable, so the session must carry the replacement forward or it
        # dies at the first token refresh.
        tokens.refresh_token = graph_tokens.refresh_token or tokens.refresh_token
        profile = await graph_client.get_department_and_company(graph_tokens.access_token)

    logger.info(
        "graph_profile_resolved",
        extra={
            "resolved": profile.resolved,
            "department": profile.department,
            "companyName": profile.company_name,
        },
    )

    try:
        session_id, _record = await services.sessions.create(
            principal=principal,
            tokens=tokens,
            department=profile.department,
            company_name=profile.company_name,
        )
    except SessionStoreUnavailable:
        return _terminal_error(
            request,
            title="Sign-in is temporarily unavailable",
            detail="The session store could not be reached.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    logger.info(
        "sign_in_complete",
        extra={
            "oid": principal.oid,
            "email": principal.email,
            "roles": principal.roles,
            "returnTo": safe_return_to(auth_state.return_to),
        },
    )
    response = RedirectResponse(
        safe_return_to(auth_state.return_to),
        status_code=status.HTTP_302_FOUND,
        headers={"Cache-Control": "no-store"},
    )
    set_session_cookie(response, session_id, max_age=settings.session_absolute_ttl_seconds)
    return response


# ── /auth/session ────────────────────────────────────────────────────────────


@router.get("/session")
async def session_info(request: Request, services: ServicesDep) -> Response:
    """The single source of identity and entitlements for the SPA (decision D7)."""
    assert services.sessions is not None  # noqa: S101
    session_id = read_session_cookie(request.cookies)

    try:
        loaded = await services.sessions.load(session_id)
    except SessionExpired as exc:
        response = JSONResponse(
            {"error": "unauthenticated", "reason": exc.reason},
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers={"Cache-Control": "no-store"},
        )
        clear_session_cookie(response)
        return response
    except SessionStoreUnavailable as exc:
        # Never 401 here: a 401 during a Firestore outage is a login storm.
        return JSONResponse(
            {"error": "unavailable"},
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            headers={"Retry-After": str(exc.retry_after), "Cache-Control": "no-store"},
        )

    record = loaded.record
    payload: dict[str, Any] = {
        "email": record.email,
        "name": record.name,
        "department": record.department,
        "companyName": record.company_name,
        "roles": record.roles,
        "csrfToken": record.csrf_token,
        "absoluteExpiresAt": record.absolute_expires_at.isoformat(),
    }
    response = JSONResponse(payload, headers={"Cache-Control": "no-store"})
    if loaded.cookie_needs_update and loaded.rotated_to:
        set_session_cookie(
            response, loaded.rotated_to, max_age=services.settings.session_absolute_ttl_seconds
        )
    return response


# ── logout ───────────────────────────────────────────────────────────────────


def _iap_clear_url(services: ServicesDep, continue_to: str) -> str:
    """Build the IAP clear-cookie URL.

    Neither the path nor its ``continue`` parameter appears in the reference
    docs (they say only "redirect to IAP's clear-cookie endpoint"), so both are
    kept configurable and confined to this one function.
    """
    path = services.settings.iap_clear_cookie_path
    if not continue_to:
        return path
    return f"{path}?{urlencode({'gcp-iap-mode': 'CLEAR_LOGIN_COOKIE', 'continue': continue_to})}"


@router.post("/logout")
async def logout(
    request: Request,
    services: ServicesDep,
    everywhere: Annotated[bool, Query()] = True,
) -> Response:
    """User-initiated logout. CSRF-protected, idempotent (docs 13 §1).

    ``everywhere=false`` clears the application and IAP sessions only;
    ``everywhere=true`` (the default) also ends the Entra session, which signs
    the user out of every Microsoft application in that browser.
    """
    assert services.sessions is not None  # noqa: S101
    settings = services.settings
    session_id = read_session_cookie(request.cookies)

    record = await services.sessions.peek(session_id)

    # CSRF is enforced against the live session when there is one. With no
    # session there is nothing to forge, and logout must stay idempotent.
    if record is not None:
        try:
            csrf.enforce(request, record.csrf_token)
        except csrf.CsrfError as exc:
            logger.warning("logout_csrf_rejected", extra={"reason": exc.reason})
            return JSONResponse(
                {"error": "csrf", "reason": exc.reason},
                status_code=status.HTTP_403_FORBIDDEN,
            )

        # Step 1: revoke at Entra while we still hold the refresh token.
        # Best effort — log a failure, never abort the logout.
        if services.oidc is not None and record.refresh_token:
            await services.oidc.revoke_refresh_token(record.refresh_token)

    # Step 2: delete the document (delete, not mark expired).
    await services.sessions.terminate(session_id, reason="user_initiated")

    # Steps 4/5: the browser must visit IAP and, optionally, Entra itself.
    entra_url = ""
    if everywhere and services.oidc is not None:
        try:
            entra_url = await services.oidc.end_session_url()
        except OidcError as exc:  # pragma: no cover - discovery already cached
            logger.warning("end_session_url_failed", extra={"error": str(exc)})

    redirect_to = (
        _iap_clear_url(services, entra_url) if settings.iap_enabled else (entra_url or "/")
    )

    response = JSONResponse(
        {"ok": True, "redirectTo": redirect_to},
        headers={"Cache-Control": "no-store"},
    )
    # Step 3: identical attributes, Max-Age=0.
    clear_session_cookie(response)
    return response


@router.get("/logout", include_in_schema=False)
async def logout_get_is_not_frontchannel() -> Response:
    """Diagnostic 405 for a front-channel logout URL registered on the wrong path.

    Entra loads the front-channel logout URL in a hidden iframe with a GET, so
    registering ``/auth/logout`` fails *invisibly*: the iframe swallows the
    405 and sessions are simply never terminated on an Entra-initiated sign-out.
    Nobody sees a broken page; the only symptom is a session that outlives the
    sign-out by up to ``SESSION_ABSOLUTE_TTL_SECONDS``.

    This path stays POST-only on purpose — docs 13 §1 forbids a GET-reachable
    logout — so the fix belongs in the app registration, not here. All this
    handler adds is a log line that names the correct path.
    """
    logger.error(
        "frontchannel_logout_misconfigured",
        extra={"expectedPath": "/auth/frontchannel-logout"},
    )
    return JSONResponse(
        {
            "error": "method_not_allowed",
            "detail": "POST /auth/logout is user-initiated logout. Entra's front-channel "
            "logout URL must be registered as /auth/frontchannel-logout.",
        },
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        headers={"Allow": "POST", "Cache-Control": "no-store"},
    )


@router.get("/frontchannel-logout")
async def frontchannel_logout(
    services: ServicesDep,
    sid: Annotated[str | None, Query()] = None,
) -> Response:
    """Entra-initiated logout. No CSRF: Entra loads this in a hidden iframe.

    Register **this** path as the front-channel logout URL in the app
    registration, not ``/auth/logout`` — the latter is a CSRF-protected POST and
    Entra will call it with a GET (docs 18 §3.3 step 6 currently says otherwise;
    see the open items in the README).
    """
    assert services.sessions is not None  # noqa: S101
    headers = {"Cache-Control": "no-store"}
    if sid:
        try:
            await services.sessions.terminate_by_entra_sid(sid)
        except SessionStoreUnavailable:
            logger.warning("frontchannel_logout_store_unavailable")
    response = Response(status_code=status.HTTP_204_NO_CONTENT, headers=headers)
    clear_session_cookie(response)
    return response


# ── convenience ──────────────────────────────────────────────────────────────


def login_redirect_url(return_to: str) -> str:
    return f"/auth/login?return_to={quote(safe_return_to(return_to), safe='/')}"
