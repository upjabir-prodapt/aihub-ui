"""Python mock upstream (decision D8, ``UPSTREAM_MODE=mock``).

Port of ``translationMockRouter.ts`` and ``salesMockRouter.ts``. It sits *behind*
the same proxy the real Apigee upstream sits behind, so the dev loop exercises
the session, CSRF and header-injection code paths rather than bypassing them —
which is what the old Vite mock plugin did.

The legacy ``/auth/whoami``, ``/auth/token`` and ``/api/metadata/id-token``
endpoints from ``mockMiddleware.ts`` are **not** ported. They were the browser's
per-service auth handshake, which decisions D6/D7 delete outright.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response

from app.proxy.mock.managers import MockDatabase

logger = logging.getLogger(__name__)

_db = MockDatabase()

TRANSLATE_ID = re.compile(r"^translate/([^/]+)$")
JOB_DOWNLOAD = re.compile(r"^jobs/([^/]+)/download$")
JOB_FILE = re.compile(r"^jobs/([^/]+)/file$")
JOB_ID = re.compile(r"^jobs/([^/]+)$")
REVIEW_ID = re.compile(r"^reviews/([^/]+)$")

SALES_STATUS = re.compile(r"^research/status/([^/]+)$")
SALES_RESULT = re.compile(r"^research/result/([^/]+)$")
SALES_DOWNLOAD = re.compile(r"^research/download/([^/]+)$")
SALES_JOB = re.compile(r"^research/([^/]+)$")

MOCK_FILE_BODY = (
    "--- Translated Document (Mock Output: {job_id}) ---\n\n"
    "Colt Technology Services - Master Services Agreement (Translated)\n\n"
    "Alle Rechte vorbehalten. Dokument wurde erfolgreich von Colt Translation AI "
    "\u00fcbersetzt."
)


def reset_mock_state() -> None:
    """Test hook; there is no HTTP route for this."""
    _db.reset()


def _error(status_code: int, message: str) -> Response:
    return JSONResponse({"error": {"message": message}}, status_code=status_code)


async def _json_body(request: Request) -> Any:
    raw = await request.body()
    if not raw:
        return None
    return json.loads(raw)


async def _multipart_fields(request: Request) -> dict[str, Any]:
    """Mirror ``parseMultipartFields``: ``name[]`` collapses into a list."""
    fields: dict[str, Any] = {}
    form = await request.form()
    for key in form.keys():  # noqa: SIM118 - starlette FormData needs explicit keys()
        values = form.getlist(key)
        for value in values:
            if hasattr(value, "filename"):
                if value.filename:
                    fields["_filename"] = value.filename
                continue
            if key.endswith("[]"):
                fields.setdefault(key[:-2], []).append(value)
            else:
                fields[key] = value
    return fields


# ── translation ──────────────────────────────────────────────────────────────


async def _translation(path: str, method: str, request: Request) -> Response | None:  # noqa: C901
    if path == "jobs" and method == "GET":
        jobs = _db.translation.get_jobs()
        return JSONResponse({"jobs": jobs, "total": len(jobs), "limit": 50, "offset": 0})

    if path == "jobs/status" and method == "POST":
        try:
            payload = await _json_body(request) or {}
        except json.JSONDecodeError:
            return _error(400, "Invalid JSON payload")
        jobs = _db.translation.get_multiple_statuses(list(payload.get("job_ids") or []))
        return JSONResponse({"jobs": jobs, "total": len(jobs)})

    if path == "translate" and method == "POST":
        fields = await _multipart_fields(request)
        filename = fields.get("_filename") or fields.get("filename") or "pasted-text.txt"
        source_lang = fields.get("source_language") or "en"
        domain = fields.get("domain") or "commercial"

        raw_targets = fields.get("target_languages")
        if isinstance(raw_targets, list):
            target_langs = raw_targets
        elif isinstance(raw_targets, str):
            target_langs = [raw_targets]
        else:
            target_langs = ["de"]

        result = _db.translation.create_jobs(
            str(filename), str(source_lang), [str(t) for t in target_langs], str(domain)
        )
        return JSONResponse(result, status_code=202)

    match = TRANSLATE_ID.match(path)
    if match and method == "GET":
        job_id = match.group(1)
        status = _db.translation.get_job_status(job_id)
        if status is None:
            return _error(404, f"Job {job_id} not found")
        return JSONResponse(status)

    match = JOB_DOWNLOAD.match(path)
    if match and method == "GET":
        job_id = match.group(1)
        status = _db.translation.get_job_status(job_id) or {}
        document = (status.get("result") or {}).get("translated_document") or {}
        return JSONResponse(
            {
                "download_url": f"/api/translation/v1/jobs/{job_id}/file",
                "filename": document.get("filename") or f"translated_{job_id}.docx",
                "expires_in": 3600,
                "file_size": 24576,
            }
        )

    match = JOB_FILE.match(path)
    if match and method == "GET":
        job_id = match.group(1)
        return PlainTextResponse(
            MOCK_FILE_BODY.format(job_id=job_id),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="translated_{job_id}.txt"'},
        )

    match = JOB_ID.match(path)
    if match and method == "DELETE":
        job_id = match.group(1)
        _db.translation.cancel_job(job_id)
        return JSONResponse({"message": f"Translation job {job_id} cancelled."})

    match = REVIEW_ID.match(path)
    if match and method == "POST":
        job_id = match.group(1)
        try:
            payload = await _json_body(request) or {}
            review = _db.translation.add_review(
                job_id, int(payload["rating"]), payload.get("comment")
            )
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            return _error(400, "Invalid review payload")
        return JSONResponse(review, status_code=201)

    return None


# ── sales ────────────────────────────────────────────────────────────────────


async def _sales(path: str, method: str, request: Request) -> Response | None:
    if path == "research/jobs" and method == "GET":
        jobs = _db.sales.get_jobs()
        return JSONResponse({"jobs": jobs, "total": len(jobs)})

    if path == "research/initiate" and method == "POST":
        try:
            payload = await _json_body(request) or {}
        except json.JSONDecodeError:
            return _error(400, "Invalid JSON payload")
        company_name = str(payload.get("company_name") or "Enterprise Target")
        account_id = str(payload.get("account_id") or f"ACC-{company_name[:3].upper()}-101")
        return JSONResponse(_db.sales.initiate_research(company_name, account_id))

    match = SALES_STATUS.match(path)
    if match and method == "GET":
        job_id = match.group(1)
        status = _db.sales.get_status(job_id)
        if status is None:
            return _error(404, f"Sales job {job_id} not found")
        return JSONResponse(status)

    match = SALES_RESULT.match(path)
    if match and method == "GET":
        job_id = match.group(1)
        result = _db.sales.get_result(job_id)
        if result is None:
            return _error(404, f"Sales result for {job_id} not found")
        return JSONResponse(result)

    match = SALES_DOWNLOAD.match(path)
    if match and method == "GET":
        job_id = match.group(1)
        result = _db.sales.get_result(job_id) or {}
        body = result.get("report_content") or (
            f"# Sales Research Report ({job_id})\n\nGenerated by Colt AI Hub Sales Agent."
        )
        return PlainTextResponse(
            body,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="sales-research-{job_id}.md"'},
        )

    match = SALES_JOB.match(path)
    if match and method == "DELETE":
        job_id = match.group(1)
        _db.sales.cancel_research(job_id)
        return JSONResponse({"message": f"Sales research job {job_id} cancelled."})

    return None


async def handle(service: str, path: str, request: Request) -> Response:
    """Dispatch one proxied request to the mock upstream.

    ``path`` is the portion after ``/api/{service}/v1/``.
    """
    path = path.strip("/")
    method = request.method.upper()

    handler = _translation if service == "translation" else _sales
    response = await handler(path, method, request)
    if response is None:
        logger.info("mock_upstream_no_route", extra={"service": service, "mockPath": path})
        return _error(404, f"No mock route for {method} /api/{service}/v1/{path}")
    return response
