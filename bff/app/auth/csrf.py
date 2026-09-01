"""CSRF defence for mutating requests.

docs 11 §5.4: ``SameSite=Lax`` is "necessary but not sufficient". Three controls
stack here, and all three must pass:

1. a per-session synchroniser token, handed out by ``GET /auth/session`` and
   echoed in ``X-CSRF-Token``;
2. an ``Origin`` / ``Sec-Fetch-Site`` check;
3. no state change on GET — enforced by only applying this to mutating verbs,
   which is also why ``POST /auth/logout`` is a POST (docs 13 §1: "A logout
   reachable by GET is itself a cross-site request forgery vector, because an
   attacker can sign a user out with an image tag").

Gap G21 requires the negative test: a mutating request without a CSRF token, or
with a foreign ``Origin``, is rejected.
"""

from __future__ import annotations

import hmac
import logging
from urllib.parse import urlparse

from starlette.requests import Request

from app.config import CSRF_HEADER_NAME

logger = logging.getLogger(__name__)

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
# Sec-Fetch-Site values that can only be produced by our own origin.
ALLOWED_FETCH_SITES = frozenset({"same-origin", "none"})


class CsrfError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def is_mutating(method: str) -> bool:
    return method.upper() not in SAFE_METHODS


def _request_origin(request: Request) -> str:
    """The origin this request was actually served on, honouring the LB headers."""
    forwarded_proto = request.headers.get("x-forwarded-proto")
    scheme = forwarded_proto.split(",")[0].strip() if forwarded_proto else request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    host = host.split(",")[0].strip()
    return f"{scheme}://{host}" if host else ""


def check_origin(request: Request) -> None:
    """Reject cross-site mutating requests before the token is even consulted."""
    fetch_site = request.headers.get("sec-fetch-site")
    if fetch_site and fetch_site not in ALLOWED_FETCH_SITES:
        raise CsrfError(f"cross-site request rejected (Sec-Fetch-Site: {fetch_site})")

    origin = request.headers.get("origin")
    if origin is None:
        # Some same-origin form posts omit Origin; fall back to Referer.
        referer = request.headers.get("referer")
        if referer:
            parsed = urlparse(referer)
            origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else None

    if origin is None:
        if fetch_site in ALLOWED_FETCH_SITES:
            return
        raise CsrfError("mutating request carries neither Origin nor Sec-Fetch-Site")

    expected = _request_origin(request)
    if expected and origin.rstrip("/") != expected.rstrip("/"):
        raise CsrfError("Origin does not match the request host")


def check_token(request: Request, session_csrf_token: str) -> None:
    supplied = request.headers.get(CSRF_HEADER_NAME)
    if not supplied:
        raise CsrfError(f"missing {CSRF_HEADER_NAME} header")
    if not session_csrf_token or not hmac.compare_digest(supplied, session_csrf_token):
        raise CsrfError("CSRF token does not match the session")


def enforce(request: Request, session_csrf_token: str) -> None:
    """Full check for a mutating request. No-op for safe methods."""
    if not is_mutating(request.method):
        return
    check_origin(request)
    check_token(request, session_csrf_token)
