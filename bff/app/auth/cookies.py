"""``__Host-AISESSION`` cookie handling.

The ``__Host-`` prefix is enforced by the browser and requires ``Secure``,
``Path=/`` and *no* ``Domain``. That is also why the BFF must serve the SPA from
the same origin (decision D1) — a cross-origin cookie could not use the prefix.

``SameSite=Lax``, never ``Strict``. docs 15 §B.10 #18: ``Strict`` "drops the
cookie on the return leg of the Entra redirect", which presents as an endless
sign-in loop.

Clearing must use *identical* attributes (docs 13 §1 step 3) — "a cookie cleared
with mismatched attributes is not cleared".
"""

from __future__ import annotations

from typing import Any

from starlette.responses import Response

from app.config import SESSION_COOKIE_NAME

_COMMON = {
    "path": "/",
    "secure": True,
    "httponly": True,
    "samesite": "lax",
}


def set_session_cookie(response: Response, session_id: str, *, max_age: int) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_id,
        max_age=max_age,
        **_COMMON,  # type: ignore[arg-type]
    )


def clear_session_cookie(response: Response) -> None:
    # Same name, same attributes, Max-Age=0.
    response.set_cookie(
        SESSION_COOKIE_NAME,
        "",
        max_age=0,
        expires=0,
        **_COMMON,  # type: ignore[arg-type]
    )


def read_session_cookie(cookies: dict[str, str]) -> str:
    return cookies.get(SESSION_COOKIE_NAME, "")


def build_set_cookie_header(session_id: str, *, max_age: int) -> str:
    holder = Response()
    set_session_cookie(holder, session_id, max_age=max_age)
    return holder.headers["set-cookie"]


class RotatedSessionCookieMiddleware:
    """Emits the successor cookie when a request triggered a rotation.

    A rotation can happen deep inside the ``get_session`` dependency, on a
    request whose handler returns a ``StreamingResponse`` that FastAPI will not
    merge dependency-set headers into. Stashing the new id on the ASGI scope and
    attaching it here is the only way to cover the proxy path as well.
    """

    def __init__(self, app: Any, *, max_age: int) -> None:
        self.app = app
        self._max_age = max_age

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        state = scope.setdefault("state", {})

        async def send_wrapper(message: Any) -> None:
            if message["type"] == "http.response.start":
                rotated = state.get("rotated_session_id")
                if rotated:
                    header = build_set_cookie_header(rotated, max_age=self._max_age)
                    message.setdefault("headers", []).append(
                        (b"set-cookie", header.encode("latin-1"))
                    )
            await send(message)

        await self.app(scope, receive, send_wrapper)
