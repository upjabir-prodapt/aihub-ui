"""IAP assertion validation.

docs 15 §0.1: the ``login_hint`` sent to Entra *must* come from the validated
``x-goog-iap-jwt-assertion``, "never from a query parameter or header the browser
supplies directly. Trusting a browser-supplied hint would let a client claim to
be signing in as anyone."

So this module has exactly one job: turn the raw assertion header into a trusted
email, or refuse. There is no unvalidated path.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from app.config import Settings

logger = logging.getLogger(__name__)

IAP_ASSERTION_HEADER = "x-goog-iap-jwt-assertion"
IAP_ISSUER = "https://cloud.google.com/iap"


class IapValidationError(RuntimeError):
    """The IAP assertion is absent, malformed, or fails verification."""


@dataclass(frozen=True, slots=True)
class IapIdentity:
    email: str
    subject: str


class IapValidator:
    """Verifies ``x-goog-iap-jwt-assertion`` against ``IAP_AUDIENCE``."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def enabled(self) -> bool:
        return self._settings.iap_enabled

    def _verify(self, assertion: str) -> dict[str, object]:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        return dict(
            id_token.verify_token(
                assertion,
                google_requests.Request(),
                audience=self._settings.iap_audience,
                certs_url="https://www.gstatic.com/iap/verify/public_key",
            )
        )

    async def validate(self, assertion: str | None) -> IapIdentity | None:
        """Return the trusted identity, or ``None`` when IAP is disabled.

        Raises ``IapValidationError`` when IAP is enabled and the assertion is
        missing or invalid — a request that reached an IAP-fronted BFF without a
        valid assertion did not come through the front door.
        """
        if not self.enabled:
            return None

        if not assertion:
            raise IapValidationError("missing x-goog-iap-jwt-assertion")

        try:
            claims = await asyncio.to_thread(self._verify, assertion)
        except Exception as exc:  # noqa: BLE001
            raise IapValidationError(f"IAP assertion verification failed: {exc}") from exc

        issuer = str(claims.get("iss", ""))
        if issuer != IAP_ISSUER:
            raise IapValidationError(f"unexpected IAP issuer {issuer!r}")

        # IAP emails are prefixed with the identity source, e.g.
        # "accounts.google.com:person@colt.net" or, for workforce identity,
        # "principal://iam.googleapis.com/...:person@colt.net".
        raw_email = str(claims.get("email", ""))
        email = raw_email.rsplit(":", 1)[-1] if raw_email else ""
        if not email:
            raise IapValidationError("IAP assertion carries no email claim")

        return IapIdentity(email=email, subject=str(claims.get("sub", "")))
