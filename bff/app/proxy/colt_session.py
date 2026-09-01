"""``DOWNSTREAM_AUTH_MODE=colt_session`` compatibility shim (decision D3).

The Translation and Sales backends may not yet trust the ``x-colt-user-*``
headers Apigee injects (docs 15 §B.11 step 8 is the migration that makes them
trustworthy). Until that lands, they still expect the legacy handshake:

    POST <service>/auth/token   { business_unit, organization }
      -> Set-Cookie: colt_session=...

which the browser used to perform per service. Here it is done **server side**,
once per user per service, and the resulting cookie is replayed on proxied
requests.

**This entire module exists to be deleted.** Nothing outside it may import
``ColtSessionShim`` or know that ``colt_session`` is a thing; the proxy asks for
"extra headers" and does not care where they came from. When step 8 lands,
delete the file, drop ``DOWNSTREAM_AUTH_MODE`` from the config, and the general
proxy path is untouched.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass

import httpx

from app.config import Settings
from app.session.model import SessionRecord

logger = logging.getLogger(__name__)

COOKIE_NAME = "colt_session"  # noqa: S105 - a cookie name, not a secret
DEFAULT_EXPIRES_IN = 3600
EXPIRY_SKEW_SECONDS = 60


@dataclass(slots=True)
class _CachedCookie:
    value: str
    expires_at: float

    @property
    def usable(self) -> bool:
        return time.monotonic() < self.expires_at - EXPIRY_SKEW_SECONDS


class ColtSessionShim:
    def __init__(self, *, settings: Settings, http: httpx.AsyncClient) -> None:
        self._settings = settings
        self._http = http
        self._cache: dict[tuple[str, str], _CachedCookie] = {}
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}
        self._guard = asyncio.Lock()

    async def _lock_for(self, key: tuple[str, str]) -> asyncio.Lock:
        async with self._guard:
            return self._locks.setdefault(key, asyncio.Lock())

    async def headers_for(
        self, *, service: str, base_url: str, record: SessionRecord
    ) -> dict[str, str]:
        cookie = await self._cookie_for(service=service, base_url=base_url, record=record)
        return {"Cookie": f"{COOKIE_NAME}={cookie}"} if cookie else {}

    async def _cookie_for(self, *, service: str, base_url: str, record: SessionRecord) -> str:
        key = (service, record.subject_oid)
        cached = self._cache.get(key)
        if cached is not None and cached.usable:
            return cached.value

        lock = await self._lock_for(key)
        async with lock:
            cached = self._cache.get(key)
            if cached is not None and cached.usable:
                return cached.value
            cookie = await self._handshake(base_url=base_url, record=record)
            if cookie is None:
                return ""
            self._cache[key] = cookie
            return cookie.value

    async def _handshake(self, *, base_url: str, record: SessionRecord) -> _CachedCookie | None:
        """Perform ``POST /auth/token`` on behalf of the user."""
        url = f"{base_url.rstrip('/')}/auth/token"
        payload = {
            # The legacy fields the old blocking modal collected. They are now
            # sourced from the Entra/Graph profile instead of asking the user.
            "business_unit": record.department or "",
            "organization": record.company_name or "",
        }
        try:
            response = await self._http.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {record.access_token}",
                    "Accept": "application/json",
                },
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            logger.error("colt_session_handshake_failed", extra={"error": str(exc)})
            return None

        if response.status_code >= 400:
            logger.error("colt_session_handshake_rejected", extra={"status": response.status_code})
            return None

        value = response.cookies.get(COOKIE_NAME)
        if not value:
            logger.error("colt_session_handshake_no_cookie")
            return None

        expires_in = DEFAULT_EXPIRES_IN
        with contextlib.suppress(ValueError, AttributeError):
            expires_in = int((response.json() or {}).get("expires_in") or DEFAULT_EXPIRES_IN)

        logger.info("colt_session_acquired", extra={"expiresIn": expires_in})
        return _CachedCookie(value=value, expires_at=time.monotonic() + expires_in)

    def invalidate_user(self, subject_oid: str) -> None:
        for key in [k for k in self._cache if k[1] == subject_oid]:
            self._cache.pop(key, None)
