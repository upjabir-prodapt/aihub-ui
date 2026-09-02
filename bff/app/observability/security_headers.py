"""Security response headers (gap G16).

G16 verbatim: *"Content Security Policy, HSTS, `X-Content-Type-Options`,
`frame-ancestors`. The BFF now serves the interface, so these are its
responsibility."* The gap register names the headers but specifies no values, so
the values below are this repo's decision and are documented here.

The old `nginx/default.conf.template` set `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` and `Content-Security-Policy:
frame-ancestors 'self'` on SPA responses. Those carry over; CSP is tightened
(the SPA is same-origin only, so `connect-src 'self'` is sufficient) and HSTS is
added, which nginx did not set.
"""

from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def build_csp(*, connect_src_extra: str = "", is_dev: bool = False) -> str:
    connect_src = "'self'"
    if connect_src_extra:
        connect_src = f"'self' {connect_src_extra.strip()}"

    # In dev, allow Swagger UI CDN resources (/docs)
    script_src = "'self' 'unsafe-inline' https://cdn.jsdelivr.net" if is_dev else "'self'"
    style_src = (
        "'self' 'unsafe-inline' https://cdn.jsdelivr.net" if is_dev else "'self' 'unsafe-inline'"
    )
    img_src = "'self' data: blob: https://fastapi.tiangolo.com" if is_dev else "'self' data: blob:"

    directives = [
        "default-src 'self'",
        # Vite emits hashed JS/CSS; no inline scripts in production.
        f"script-src {script_src}",
        # React inlines component styles at runtime.
        f"style-src {style_src}",
        f"img-src {img_src}",
        "font-src 'self' data:",
        f"connect-src {connect_src}",
        # Signed-URL uploads target GCS directly from the browser.
        "form-action 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "upgrade-insecure-requests",
    ]
    return "; ".join(directives)


class SecurityHeadersMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        hsts_max_age: int,
        csp: str,
        report_only: bool = False,
        enable_hsts: bool = True,
    ) -> None:
        self.app = app
        self._csp_header = (
            "content-security-policy-report-only" if report_only else "content-security-policy"
        )
        self._csp = csp
        self._hsts = (
            f"max-age={hsts_max_age}; includeSubDomains" if enable_hsts and hsts_max_age else ""
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("x-content-type-options", "nosniff")
                headers.setdefault("referrer-policy", "strict-origin-when-cross-origin")
                headers.setdefault("permissions-policy", "camera=(), microphone=(), geolocation=()")
                headers.setdefault("x-frame-options", "SAMEORIGIN")
                headers.setdefault("cross-origin-opener-policy", "same-origin")
                headers.setdefault(self._csp_header, self._csp)
                if self._hsts:
                    headers.setdefault("strict-transport-security", self._hsts)
            await send(message)

        await self.app(scope, receive, send_wrapper)
