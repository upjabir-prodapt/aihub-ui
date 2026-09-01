"""``POST /api/translation/uploads``.

Returns a signed GCS PUT URL plus the ``gs://`` URI the SPA then submits with the
translation job, so the document itself never crosses Apigee (decision D10).

When ``TRANSLATION_UPLOAD_MODE=multipart`` this endpoint reports that it is
disabled and the SPA posts the file to ``/api/translation/v1/translate`` as
before, which the proxy streams straight through. The fallback exists because
the Translation backend accepting ``gs://`` inputs is an unconfirmed external
dependency (plan §12).

The route is registered before the ``/api/{service}/v1/{path}`` catch-all so it
is not swallowed by the proxy.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.deps import CsrfSessionDep, ServicesDep
from app.uploads.gcs import GcsSigner, SigningUnavailableError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["uploads"])

# 15 MB matched the old nginx `client_max_body_size`; the signed-URL path has no
# such limit, but the request that *asks* for a URL declares the size so the
# server can refuse the obviously absurd before minting one.
MAX_DECLARED_BYTES = 200 * 1024 * 1024


class UploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream", max_length=255)
    size_bytes: int | None = Field(default=None, ge=0)


class UploadResponse(BaseModel):
    upload_url: str
    gs_uri: str
    object_name: str
    expires_in: int
    required_headers: dict[str, str]


@router.post("/translation/uploads", response_model=UploadResponse)
async def create_translation_upload(
    payload: UploadRequest,
    services: ServicesDep,
    session: CsrfSessionDep,
) -> UploadResponse:
    settings = services.settings

    if settings.translation_upload_mode != "gcs_signed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "signed_uploads_disabled",
                "uploadMode": settings.translation_upload_mode,
            },
        )

    if payload.size_bytes is not None and payload.size_bytes > MAX_DECLARED_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"error": "file_too_large", "maxBytes": MAX_DECLARED_BYTES},
        )

    signer = GcsSigner(settings)
    try:
        signed = await signer.signed_put_url(
            subject_oid=session.record.subject_oid,
            filename=payload.filename,
            content_type=payload.content_type,
        )
    except SigningUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "signing_unavailable", "message": str(exc)},
        ) from exc

    logger.info(
        "signed_upload_issued",
        extra={"objectName": signed.object_name, "oid": session.record.subject_oid},
    )
    return UploadResponse(
        upload_url=signed.upload_url,
        gs_uri=signed.gs_uri,
        object_name=signed.object_name,
        expires_in=signed.expires_in,
        required_headers=signed.required_headers,
    )
