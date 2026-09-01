"""Apigee-facing header injection (decision D2, docs 15 §B.11).

The BFF sends three things Apigee cares about:

1. ``Authorization: Bearer <entra access token>`` — verified by the Verify JWT
   policy against the tenant JWKS, issuer and ``ENTRA_APP_ID_URI`` audience.
2. the API key header — resolves the API Product the quota policies measure.
3. ``x-colt-user-*`` trusted context headers.

**Known external dependency (plan §12, docs 19 §3.4).** Apigee's Assign Message
policy (docs 15 §B.11 step 8) currently strips inbound ``x-colt-*`` and
re-injects only the verified ``oid``/``roles``. Until that policy is updated,
``department`` and ``company`` will vanish between here and the backend, silently
and with a passing local test. Raise it before Phase 4 sign-off.
"""

from __future__ import annotations

import logging

from app.config import Settings
from app.secrets.manager import SecretsManager, SecretsUnavailableError
from app.session.model import SessionRecord

logger = logging.getLogger(__name__)


class ApigeeHeaderInjector:
    def __init__(self, *, settings: Settings, secrets: SecretsManager) -> None:
        self._settings = settings
        self._secrets = secrets

    async def _api_key(self) -> str:
        try:
            return await self._secrets.get(self._settings.apigee_api_key_secret)
        except SecretsUnavailableError as exc:
            logger.error("apigee_api_key_unavailable", extra={"error": str(exc)})
            return ""

    async def headers_for(self, record: SessionRecord) -> dict[str, str]:
        settings = self._settings
        headers: dict[str, str] = {
            "Authorization": f"Bearer {record.access_token}",
            settings.apigee_user_oid_header: record.subject_oid,
            "x-colt-user-email": record.email,
            "x-colt-user-roles": ",".join(record.roles),
        }
        if record.department:
            headers["x-colt-user-department"] = record.department
        if record.company_name:
            headers["x-colt-user-company"] = record.company_name

        api_key = await self._api_key()
        if api_key:
            headers[settings.apigee_api_key_header] = api_key
        return headers

    def base_url_for(self, service: str) -> str:
        base = self._settings.apigee_base_url.rstrip("/")
        path = (
            self._settings.apigee_translation_path
            if service == "translation"
            else self._settings.apigee_sales_path
        )
        return f"{base}{path}"
