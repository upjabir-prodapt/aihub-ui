"""Microsoft Graph lookup for ``department`` and ``companyName``.

Decision D6 / docs 19 Option A. These are *not* obtainable as token claims:
Entra's optional-claims picker only offers a fixed built-in set, and
``department``/``companyName`` are Graph user-profile properties, not claims
(docs 18 §3.2 — "You will not find them there — and that's expected").

They are a reporting dimension, not a security control (docs 19 §2), so this
call fails **open** with the documented placeholder strings. A Graph hiccup must
never block sign-in.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

GRAPH_ME_PATH = "/v1.0/me?$select=department,companyName"


@dataclass(frozen=True, slots=True)
class GraphProfile:
    department: str
    company_name: str
    resolved: bool


class GraphClient:
    def __init__(self, *, settings: Settings, http: httpx.AsyncClient) -> None:
        self._settings = settings
        self._http = http

    def fallback_profile(self) -> GraphProfile:
        """The documented placeholders (docs 19 §3.3), used on every failure path.

        Public because the caller also needs it when the Graph token exchange
        itself fails and no Graph call is attempted at all.
        """
        return GraphProfile(
            department=self._settings.graph_unknown_department,
            company_name=self._settings.graph_unknown_company,
            resolved=False,
        )

    async def get_department_and_company(self, access_token: str) -> GraphProfile:
        """``GET /v1.0/me?$select=department,companyName``; fail open."""
        if not access_token:
            return self.fallback_profile()

        url = f"{self._settings.graph_base_url.rstrip('/')}{GRAPH_ME_PATH}"
        try:
            response = await self._http.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=self._settings.graph_http_timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001 - fail open by design
            logger.warning("graph_profile_unreachable", extra={"error": str(exc)})
            return self.fallback_profile()

        if response.status_code >= 400:
            # A 401 here usually means User.Read was never consented (docs 19 §3.1).
            logger.warning("graph_profile_rejected", extra={"status": response.status_code})
            return self.fallback_profile()

        try:
            profile = response.json()
        except ValueError:
            logger.warning("graph_profile_unparseable")
            return self.fallback_profile()

        return GraphProfile(
            department=str(profile.get("department") or self._settings.graph_unknown_department),
            company_name=str(profile.get("companyName") or self._settings.graph_unknown_company),
            resolved=True,
        )
