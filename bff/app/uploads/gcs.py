"""V4 signed PUT URLs for translation source documents (decision D10).

docs 13 §6 records that Apigee's payload ceiling is unmeasured, and document
translation is the thing most likely to hit it. So the file goes browser -> GCS
directly and only the ``gs://`` URI crosses the gateway.

**Signing needs a credential that can sign.** Cloud Run's metadata-server
credentials have no private key, so ``blob.generate_signed_url`` falls back to
the IAM ``signBlob`` API, which requires ``roles/iam.serviceAccountTokenCreator``
on ``aihub-bff-sa`` *for itself*. Phase 7 task 35 exists to confirm that binding.
If it is missing, this raises at request time with a message that says so rather
than a generic 500.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import timedelta

from app.config import Settings

logger = logging.getLogger(__name__)

SIGNED_URL_TTL = timedelta(minutes=15)
# Conservative: anything outside this set gets a generated name.
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")
MAX_NAME_LENGTH = 120


class SigningUnavailableError(RuntimeError):
    """The runtime service account cannot sign URLs."""


@dataclass(frozen=True, slots=True)
class SignedUpload:
    upload_url: str
    gs_uri: str
    object_name: str
    expires_in: int
    required_headers: dict[str, str]


def sanitise_filename(filename: str) -> str:
    cleaned = SAFE_NAME.sub("_", (filename or "").strip()).strip("._")
    if not cleaned:
        return "upload.bin"
    return cleaned[-MAX_NAME_LENGTH:]


def object_name_for(*, subject_oid: str, filename: str) -> str:
    """Namespace uploads per user so one user cannot overwrite another's object."""
    safe_oid = SAFE_NAME.sub("_", subject_oid) or "unknown"
    return f"uploads/{safe_oid}/{uuid.uuid4().hex}/{sanitise_filename(filename)}"


class GcsSigner:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: object | None = None

    def _ensure_client(self) -> object:
        if self._client is None:
            from google.cloud import storage  # type: ignore[attr-defined] # lazy

            self._client = storage.Client(project=self._settings.gcp_project_id)
        return self._client

    def _sign(self, object_name: str, content_type: str) -> str:
        client = self._ensure_client()
        bucket = client.bucket(self._settings.gcs_upload_bucket)  # type: ignore[attr-defined]
        blob = bucket.blob(object_name)

        kwargs: dict[str, object] = {
            "version": "v4",
            "expiration": SIGNED_URL_TTL,
            "method": "PUT",
            "content_type": content_type,
        }
        # On Cloud Run there is no private key, so signing goes through IAM
        # signBlob and needs the signer identity spelled out.
        if self._settings.gcs_signer_service_account:
            kwargs["service_account_email"] = self._settings.gcs_signer_service_account
            kwargs["access_token"] = self._access_token()

        return str(blob.generate_signed_url(**kwargs))

    def _access_token(self) -> str:
        import google.auth
        from google.auth.transport.requests import Request as AuthRequest

        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        credentials.refresh(AuthRequest())  # type: ignore[no-untyped-call]
        return str(credentials.token)

    async def signed_put_url(
        self, *, subject_oid: str, filename: str, content_type: str
    ) -> SignedUpload:
        object_name = object_name_for(subject_oid=subject_oid, filename=filename)
        try:
            url = await asyncio.to_thread(self._sign, object_name, content_type)
        except Exception as exc:  # noqa: BLE001
            logger.error("signed_url_generation_failed", extra={"error": str(exc)})
            raise SigningUnavailableError(
                "Could not sign an upload URL. Check that the runtime service account "
                "holds roles/iam.serviceAccountTokenCreator on itself (plan task 35)."
            ) from exc

        return SignedUpload(
            upload_url=url,
            gs_uri=f"gs://{self._settings.gcs_upload_bucket}/{object_name}",
            object_name=object_name,
            expires_in=int(SIGNED_URL_TTL.total_seconds()),
            # The browser PUT must send exactly this or the signature will not match.
            required_headers={"Content-Type": content_type},
        )
