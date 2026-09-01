"""Streaming reverse proxy primitives.

Request and response bodies are streamed, never buffered — decision D10 exists
because Apigee has an unmeasured payload ceiling, and buffering a large document
in the BFF would put the ceiling in the BFF as well.

Two header rules carry real security weight:

* **Every inbound ``x-colt-*`` is dropped.** The whole trust chain (docs 11 §7.6)
  is "any ``x-colt-*`` header was set by Apigee, therefore it is trustworthy".
  A client-supplied one that survived would let a caller pick its own ``oid``.
* **``X-Serverless-Authorization`` is dropped.** Runbook §20.7: it is how IAP
  talks to Cloud Run internally — "Never construct it in a caller."

Gap G21's proxy test asserts both.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Mapping
from typing import Protocol

import httpx
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse

logger = logging.getLogger(__name__)

# RFC 7230 §6.1 hop-by-hop headers, plus the ones a proxy must own itself.
HOP_BY_HOP = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "trailers",
        "transfer-encoding",
        "upgrade",
    }
)

# Never forwarded upstream, whatever the client sends.
STRIPPED_REQUEST_HEADERS = frozenset(
    {
        "host",
        "cookie",
        "authorization",
        "x-serverless-authorization",
        "x-goog-iap-jwt-assertion",
        "x-goog-authenticated-user-email",
        "x-goog-authenticated-user-id",
        "x-colt-hub-iap-assertion",
        "x-csrf-token",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "content-length",
    }
)

# Never returned to the browser.
STRIPPED_RESPONSE_HEADERS = frozenset(
    {
        "set-cookie",
        "content-length",
        "content-encoding",
        "www-authenticate",
    }
)


class UpstreamError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class HeaderInjector(Protocol):
    """Adds the trusted, server-derived headers for one upstream."""

    async def headers_for(self, *, service: str) -> dict[str, str]: ...


def filter_request_headers(headers: Mapping[str, str]) -> dict[str, str]:
    """Allow-list by exclusion: drop hop-by-hop, sensitive, and all ``x-colt-*``."""
    out: dict[str, str] = {}
    for key, value in headers.items():
        lower = key.lower()
        if lower in HOP_BY_HOP or lower in STRIPPED_REQUEST_HEADERS:
            continue
        if lower.startswith("x-colt-"):
            # Client-supplied identity headers are forged by definition.
            logger.warning("client_colt_header_stripped", extra={"header": lower})
            continue
        out[key] = value
    return out


def filter_response_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in HOP_BY_HOP and key.lower() not in STRIPPED_RESPONSE_HEADERS
    }


async def _request_body(request: Request) -> AsyncIterator[bytes]:
    async for chunk in request.stream():
        yield chunk


class StreamingProxy:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def forward(
        self,
        request: Request,
        *,
        url: str,
        extra_headers: Mapping[str, str],
        upstream_timeout: float,
    ) -> Response:
        headers = filter_request_headers(request.headers)
        headers.update(extra_headers)

        # GET/HEAD/DELETE without a declared body must not advertise a stream, or
        # httpx sends a chunked encoding some gateways reject.
        has_body = request.method.upper() not in {"GET", "HEAD", "DELETE", "OPTIONS"}

        upstream_request = self._client.build_request(
            request.method,
            url,
            headers=headers,
            params=dict(request.query_params),
            content=_request_body(request) if has_body else None,
            timeout=upstream_timeout,
        )

        try:
            upstream_response = await self._client.send(upstream_request, stream=True)
        except httpx.TimeoutException as exc:
            raise UpstreamError("upstream timed out", status_code=504) from exc
        except httpx.HTTPError as exc:
            raise UpstreamError(f"upstream unreachable: {exc}", status_code=502) from exc

        async def body() -> AsyncIterator[bytes]:
            try:
                async for chunk in upstream_response.aiter_raw():
                    yield chunk
            finally:
                await upstream_response.aclose()

        return StreamingResponse(
            body(),
            status_code=upstream_response.status_code,
            headers=filter_response_headers(upstream_response.headers),
            media_type=upstream_response.headers.get("content-type"),
        )
