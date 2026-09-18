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
SALES_FEEDBACK = re.compile(r"^research/([^/]+)/feedback$")

NAAS_TICKET_APPROVE = re.compile(r"^admin/tickets/(\d+)/approve$")
NAAS_CIRCUIT_ROUTE = re.compile(r"^circuits/([^/]+)/route$")

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


def _mock_pdf(text: str) -> bytes:
    """Smallest well-formed one-page PDF carrying `text`.

    The Sales Agent service streams application/pdf, so the mock must too:
    serving markdown let a UI that mishandled real PDFs still look correct in
    mock mode. Only the first line is drawn — this exists to be a valid PDF,
    not to render the report.
    """
    first_line = text.strip().splitlines()[0] if text.strip() else "Mock report"
    escaped = first_line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")[:90]
    stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode()

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + body + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 " + str(len(objects) + 1).encode() + b"\n"
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        b"trailer\n<< /Size " + str(len(objects) + 1).encode() + b" /Root 1 0 R >>\n"
        b"startxref\n" + str(xref_at).encode() + b"\n%%EOF\n"
    )
    return bytes(out)


async def _translation(path: str, method: str, request: Request) -> Response | None:  # noqa: C901
    if path == "jobs" and method == "GET":
        jobs = _db.translation.get_jobs()
        limit = int(request.query_params.get("limit") or 10)
        offset = int(request.query_params.get("offset") or 0)
        return JSONResponse({"jobs": jobs, "total": len(jobs), "limit": limit, "offset": offset})

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

    # Mock-only: production's /jobs/{id}/download returns a signed GCS URL that
    # serves the bytes directly. The mock cannot sign one, so it points its
    # download_url back here. No Translation service route matches this path.
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
        # ReviewSubmitResponse: an acknowledgement, not the stored record.
        # Returning the full review here hid a frontend type mismatch.
        return JSONResponse(
            {"status": "success", "review_id": review["review_id"]}, status_code=201
        )

    return None


# ── sales ────────────────────────────────────────────────────────────────────


async def _sales(path: str, method: str, request: Request) -> Response | None:
    if path == "research/jobs" and method == "GET":
        # Bare array, matching the service: its handler is typed
        # list[ResearchJobListItem] with no envelope.
        return JSONResponse(_db.sales.get_jobs())

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
        # The service streams application/pdf named Research_Report_<Company>.pdf.
        # Serving markdown here trained the UI to expect the wrong media type.
        # The company lives on the job record, not the result payload.
        job = next((j for j in _db.sales.get_jobs() if j.get("job_id") == job_id), {})
        company = str(job.get("company_name") or job.get("company") or "Company")
        safe_company = re.sub(r"[^A-Za-z0-9]+", "_", company).strip("_") or "Company"
        return Response(
            _mock_pdf(body),
            media_type="application/pdf",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="Research_Report_{safe_company}.pdf"'
                )
            },
        )

    # Must be tried before SALES_JOB, whose pattern would otherwise swallow
    # "<job_id>/feedback" as a job id.
    match = SALES_FEEDBACK.match(path)
    if match and method == "POST":
        job_id = match.group(1)
        try:
            payload = await _json_body(request) or {}
        except json.JSONDecodeError:
            return _error(400, "Invalid JSON payload")
        # Mirrors ResearchFeedbackRequest: a required 1-5 rating, an optional
        # 1-1000 char comment, and extra="forbid". Kept strict so mock mode
        # catches a malformed body the way the service would.
        if set(payload) - {"rating", "feedback"}:
            return _error(422, "unexpected fields in feedback payload")
        rating = payload.get("rating")
        if not isinstance(rating, int) or isinstance(rating, bool) or not 1 <= rating <= 5:
            return _error(422, "rating must be an integer between 1 and 5")
        if "feedback" in payload:
            feedback = payload["feedback"]
            # 2000 matches the Translation review comment; the services were
            # aligned so the shared dialog has one character limit.
            if not isinstance(feedback, str) or not 1 <= len(feedback) <= 2000:
                return _error(422, "feedback must be a string of 1-2000 characters")
        return JSONResponse(
            {
                "job_id": job_id,
                "status": "SUCCESS",
                "message": "Feedback submitted successfully",
            }
        )

    match = SALES_JOB.match(path)
    if match and method == "DELETE":
        job_id = match.group(1)
        _db.sales.cancel_research(job_id)
        return JSONResponse({"message": f"Sales research job {job_id} cancelled."})

    return None


# ── naas ─────────────────────────────────────────────────────────────────────


def _sse_chat_reply(agent_id: str, message: str, session_id: str | None) -> Response:
    """One canned SSE frame set — see naas.ts's postChatStream for the shapes.

    Real turns stream text_delta/tool_result events as they happen; the mock
    sends its whole (short) reply as a single text_delta immediately followed
    by done, which the frontend's frame parser handles identically to a real
    multi-chunk turn just without the incremental rendering.
    """
    reply = f'[mock] {agent_id} received: "{message}"'
    frames = [
        {"type": "text_delta", "text": reply, "agent": agent_id},
        {"type": "done", "tool_results": {}, "agent": agent_id},
    ]
    body = "".join(f"data: {json.dumps(frame)}\n\n" for frame in frames)
    return Response(body, media_type="text/event-stream")


async def _naas(path: str, method: str, request: Request) -> Response | None:  # noqa: C901
    if path == "agents" and method == "GET":
        return JSONResponse(_db.naas.get_agents())

    if path == "chat" and method == "POST":
        payload = await _json_body(request) or {}
        return _sse_chat_reply(
            payload.get("agent_id", "orchestrator"),
            payload.get("message", ""),
            payload.get("session_id"),
        )

    if path == "admin/tickets/pending" and method == "GET":
        return JSONResponse(_db.naas.get_pending_tickets())

    if path == "admin/tickets/history" and method == "GET":
        return JSONResponse(_db.naas.get_ticket_history())

    match = NAAS_TICKET_APPROVE.match(path)
    if match and method == "POST":
        ticket_id = int(match.group(1))
        ticket = _db.naas.approve_ticket(ticket_id)
        if ticket is None:
            return _error(404, f"Ticket {ticket_id} not found")
        return JSONResponse(ticket)

    # Service Reliability Agent — left-panel dashboard. No Reliability Rule
    # exists in the mock, so the demo circuit is always empty (the panel's
    # own WorldMap/disabled-Simulate-buttons fallback handles this — see
    # DemoCircuit's own null-both-fields comment) and every list is empty.
    if path == "reliability/demo-circuit" and method == "GET":
        return JSONResponse({"circuit_reference": None, "name": None})

    if path in {
        "reliability/simulate/utilization-high",
        "reliability/simulate/utilization-low",
    } and method == "POST":
        return _error(409, "No reliability rule exists to simulate against in mock mode")

    if path == "reliability/rules" and method == "GET":
        return JSONResponse([])

    if path == "reliability/events" and method == "GET":
        return JSONResponse([])

    if path == "reliability/audit-log" and method == "GET":
        return JSONResponse([])

    match = NAAS_CIRCUIT_ROUTE.match(path)
    if match and method == "GET":
        return _error(404, f"No route found for circuit {match.group(1)}")

    return None


_HANDLERS = {"translation": _translation, "sales": _sales, "naas": _naas}


async def handle(service: str, path: str, request: Request) -> Response:
    """Dispatch one proxied request to the mock upstream.

    ``path`` is the portion after ``/api/{service}/v1/``.
    """
    path = path.strip("/")
    method = request.method.upper()

    handler = _HANDLERS[service]
    response = await handler(path, method, request)
    if response is None:
        logger.info("mock_upstream_no_route", extra={"service": service, "mockPath": path})
        return _error(404, f"No mock route for {method} /api/{service}/v1/{path}")
    return response
