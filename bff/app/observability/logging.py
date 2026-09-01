"""Structured JSON logging with a per-request correlation id.

Cloud Logging picks up ``severity`` and ``message`` from a JSON line on stdout,
so no agent or client library is needed.

The old nginx config took care to log only the *presence* of the IAP assertion,
never its value. That property is preserved here: this module never logs
cookies, tokens, ``Authorization``, or the IAP assertion.
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

_RESERVED = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
    | {"message", "asctime", "taskName"}
)

_SEVERITY = {
    "DEBUG": "DEBUG",
    "INFO": "INFO",
    "WARNING": "WARNING",
    "ERROR": "ERROR",
    "CRITICAL": "CRITICAL",
}

# Never emit these, whatever a caller passes in `extra`.
_REDACT = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "access_token",
        "refresh_token",
        "id_token",
        "client_secret",
        "code",
        "session_id",
        "csrf_token",
        "x-goog-iap-jwt-assertion",
    }
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "severity": _SEVERITY.get(record.levelname, record.levelname),
            "message": record.getMessage(),
            "logger": record.name,
            "requestId": request_id_var.get(),
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
        }
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            payload[key] = "[redacted]" if key.lower() in _REDACT else value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # uvicorn's own access log duplicates RequestLogMiddleware and is unstructured.
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.access").propagate = False
    logging.getLogger("uvicorn.error").handlers = [handler]
    logging.getLogger("uvicorn.error").propagate = False


class RequestLogMiddleware:
    """Assigns a request id and emits one structured line per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._log = logging.getLogger("app.request")

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        incoming = request.headers.get("x-cloud-trace-context") or request.headers.get(
            "x-request-id"
        )
        request_id = (incoming or uuid.uuid4().hex).split("/")[0][:64]
        token = request_id_var.set(request_id)
        scope.setdefault("state", {})
        scope["state"]["request_id"] = request_id

        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: Any) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = message.setdefault("headers", [])
                headers.append((b"x-request-id", request_id.encode("latin-1")))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            request_id_var.reset(token)
            self._log.info(
                "http_request",
                extra={
                    "httpMethod": request.method,
                    "path": request.url.path,
                    "status": status_holder["status"],
                    "durationMs": round((time.perf_counter() - started) * 1000, 2),
                    # Presence only, never the value — same rule the old nginx
                    # log_format followed.
                    "iapAssertionPresent": "x-goog-iap-jwt-assertion" in request.headers,
                    "requestId": request_id,
                },
            )


AsyncCall = Callable[[Request], Awaitable[Response]]
