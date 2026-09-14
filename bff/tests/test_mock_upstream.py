"""Mock-upstream fidelity (plan §12: "port fixtures verbatim; snapshot-test shapes").

The frontend is coupled to the exact JSON the old TypeScript mocks emitted. A
subtly different Python port produces failures that look like frontend bugs, so
these assertions are transcribed from `scripts/verify-mock-api.mjs` — the script
that guarded the TypeScript version — plus the response shapes the pages read.
"""

from __future__ import annotations

import httpx
import pytest

from app.proxy.mock.reports import (
    DEUTSCHE_TELEKOM_REPORT,
    VODAFONE_REPORT,
    generate_custom_report,
)
from tests.conftest import same_origin_headers

pytestmark = pytest.mark.usefixtures("signed_in")


# ── Translation, ported from verify-mock-api.mjs ─────────────────────────────


async def test_list_translation_jobs(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/translation/v1/jobs")
    body = response.json()

    assert response.status_code == 200
    assert isinstance(body["jobs"], list)
    assert len(body["jobs"]) >= 4
    assert body["total"] == len(body["jobs"])
    # Paging echoes the request. The service defaults `limit` to 10, which is
    # why the frontend now asks for it explicitly.
    assert body["limit"] == 10
    assert body["offset"] == 0


async def test_translation_job_list_echoes_requested_paging(
    client: httpx.AsyncClient,
) -> None:
    body = (await client.get("/api/translation/v1/jobs?limit=100&offset=2")).json()
    assert body["limit"] == 100
    assert body["offset"] == 2


async def test_translation_job_list_item_shape(client: httpx.AsyncClient) -> None:
    job = (await client.get("/api/translation/v1/jobs")).json()["jobs"][0]
    assert set(job) == {
        "job_id",
        "status",
        "progress",
        "current_stage",
        "user",
        "department",
        "created_at",
        "updated_at",
        "completed_at",
        "download_url",
        "error_message",
        "filename",
        "source_language",
        "target_language",
    }
    assert job["user"] == "dev@colt.net"
    assert job["department"] == "Technology & Operations"


async def test_translation_job_detail_carries_cost(client: httpx.AsyncClient) -> None:
    jobs = (await client.get("/api/translation/v1/jobs")).json()["jobs"]
    sample = jobs[0]

    response = await client.get(f"/api/translation/v1/translate/{sample['job_id']}")
    detail = response.json()

    assert response.status_code == 200
    assert detail["job_id"] == sample["job_id"]
    assert detail["result"]["labels"]["cost_usd"] is not None
    assert detail["result"]["metadata"]["model_used"] == "gemini-1.5-pro"


async def test_unknown_translation_job_is_404_with_an_error_envelope(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/translation/v1/translate/nope")
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Job nope not found"


async def test_create_translation_job_returns_202_and_a_batch(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/api/translation/v1/translate",
        files={"file": ("test-spec.txt", b"Colt test document text", "text/plain")},
        data={
            "source_language": "en",
            "target_languages[]": "de",
            "domain": "commercial",
        },
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    body = response.json()

    assert response.status_code == 202
    assert body["batch_id"].startswith("batch-")
    assert len(body["jobs"]) == 1
    assert body["jobs"][0]["target_language"] == "de"
    assert body["jobs"][0]["status"] == "queued"


async def test_multiple_target_languages_create_one_job_each(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/api/translation/v1/translate",
        files={"file": ("spec.docx", b"content", "application/octet-stream")},
        data={"target_languages[]": ["de", "fr"]},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    jobs = response.json()["jobs"]
    assert [j["target_language"] for j in jobs] == ["de", "fr"]


async def test_bulk_status_reports_unknown_ids_as_failed(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/api/translation/v1/jobs/status",
        json={"job_ids": ["trans-job-8901", "does-not-exist"]},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    jobs = response.json()["jobs"]

    assert jobs[0]["job_id"] == "trans-job-8901"
    assert jobs[1] == {
        "job_id": "does-not-exist",
        "target_language": "en",
        "status": "failed",
        "error_message": "Job not found",
    }


async def test_download_metadata_shape(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/translation/v1/jobs/trans-job-8901/download")
    body = response.json()
    assert body["expires_in"] == 3600
    assert body["file_size"] == 24576
    assert body["filename"] == "Colt_Master_Services_Agreement_2026_de.docx"


async def test_file_download_sets_a_content_disposition(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/translation/v1/jobs/trans-job-8901/file")
    assert response.status_code == 200
    assert 'filename="translated_trans-job-8901.txt"' in response.headers["content-disposition"]
    assert "Colt Technology Services" in response.text


async def test_review_returns_201(client: httpx.AsyncClient, signed_in: dict[str, object]) -> None:
    response = await client.post(
        "/api/translation/v1/reviews/trans-job-8901",
        json={"rating": 5, "comment": "Translation accuracy was excellent."},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    body = response.json()

    assert response.status_code == 201
    # ReviewSubmitResponse — the service acknowledges the write rather than
    # echoing the stored review, which only `GET /reviews/{job_id}` returns.
    assert set(body) == {"status", "review_id"}
    assert body["review_id"]


async def test_cancel_translation_job(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.request(
        "DELETE",
        "/api/translation/v1/jobs/trans-job-8901",
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    assert response.status_code == 200
    assert response.json()["message"] == "Translation job trans-job-8901 cancelled."

    detail = await client.get("/api/translation/v1/translate/trans-job-8901")
    assert detail.json()["status"] == "cancelled"


# ── Sales, ported from verify-mock-api.mjs ───────────────────────────────────


async def test_list_sales_jobs(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/sales/v1/research/jobs")
    body = response.json()

    assert response.status_code == 200
    # The service returns a bare list, not an envelope.
    assert isinstance(body, list)
    # `company` duplicates `company_name`; the page reads both.
    assert body[0]["company"] == body[0]["company_name"]


async def test_initiate_sales_research(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/api/sales/v1/research/initiate",
        json={"company_name": "Microsoft UK", "account_id": "ACC-MSFT-9901"},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    body = response.json()

    assert response.status_code == 200
    assert body["job_id"].startswith("sales-job-")
    assert body["status"] == "PENDING"


async def test_initiate_derives_an_account_id_when_absent(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    created = await client.post(
        "/api/sales/v1/research/initiate",
        json={"company_name": "Vodafone"},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    job_id = created.json()["job_id"]

    listed = (await client.get("/api/sales/v1/research/jobs")).json()
    match = next(j for j in listed if j["job_id"] == job_id)
    assert match["account_id"] == "ACC-VOD-101"


async def test_sales_result_and_status_shapes(client: httpx.AsyncClient) -> None:
    status = (await client.get("/api/sales/v1/research/status/sales-job-7001")).json()
    assert set(status) == {"job_id", "status", "error_message"}

    result = (await client.get("/api/sales/v1/research/result/sales-job-7001")).json()
    assert set(result) == {
        "job_id",
        "request_id",
        "status",
        "report_content",
        "model_card",
    }
    assert result["report_content"] == VODAFONE_REPORT
    assert result["model_card"]["model_version"] == "gemini-2.5-pro"


async def test_sales_download_is_a_pdf(client: httpx.AsyncClient) -> None:
    """The service streams application/pdf, so the mock must too."""
    response = await client.get("/api/sales/v1/research/download/sales-job-7002")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content.startswith(b"%PDF-")
    assert "Research_Report_" in response.headers["content-disposition"]
    assert response.headers["content-disposition"].endswith('.pdf"')


async def test_unknown_sales_job_is_404(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/sales/v1/research/status/nope")
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Sales job nope not found"


async def test_failed_seed_job_keeps_its_error_message(
    client: httpx.AsyncClient,
) -> None:
    jobs = (await client.get("/api/sales/v1/research/jobs")).json()
    failed = next(j for j in jobs if j["status"] == "FAILED")
    assert failed["error_message"].startswith("Public intelligence extraction failed")


# ── Report fixtures ──────────────────────────────────────────────────────────


def test_report_fixtures_are_verbatim() -> None:
    assert VODAFONE_REPORT.startswith("# Strategic Account Intelligence: Vodafone Group Plc")
    assert "ACC-VOD-8821" in VODAFONE_REPORT
    assert "€36.7 Billion" in VODAFONE_REPORT
    assert DEUTSCHE_TELEKOM_REPORT.startswith(
        "# Strategic Account Intelligence: Deutsche Telekom AG"
    )
    assert "Gaia-X" in DEUTSCHE_TELEKOM_REPORT


def test_custom_report_interpolates_the_account() -> None:
    report = generate_custom_report("Acme Ltd", "ACC-ACM-101")
    assert report.startswith("# Comprehensive Account Intelligence: Acme Ltd")
    assert "**Account Identifier:** ACC-ACM-101" in report
    assert "Generated By:** Colt Sales Agent (Gemini 2.5 Pro)" in report


# ── Removed endpoints ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "/api/translation/v1/auth/whoami",
        "/api/sales/v1/auth/whoami",
        "/api/metadata/id-token",
    ],
)
async def test_legacy_browser_auth_endpoints_are_gone(client: httpx.AsyncClient, path: str) -> None:
    """Decisions D6/D7 delete the per-service handshake and the metadata token."""
    response = await client.get(path)
    assert response.status_code == 404


async def test_research_feedback_is_accepted(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/api/sales/v1/research/sales-job-7002/feedback",
        json={"rating": 5, "feedback": "The tech-stack section was the most useful part."},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["job_id"] == "sales-job-7002"
    assert set(body) == {"job_id", "status", "message"}


async def test_research_feedback_rejects_an_empty_comment(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    """The comment is optional, but an empty one is malformed, not absent."""
    response = await client.post(
        "/api/sales/v1/research/sales-job-7002/feedback",
        json={"rating": 3, "feedback": ""},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    assert response.status_code == 422


async def test_research_feedback_accepts_a_rating_alone(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    response = await client.post(
        "/api/sales/v1/research/sales-job-7002/feedback",
        json={"rating": 4},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    assert response.status_code == 200


@pytest.mark.parametrize("rating", [0, 6, -1, "five", True, None])
async def test_research_feedback_rejects_a_bad_rating(
    client: httpx.AsyncClient, signed_in: dict[str, object], rating: object
) -> None:
    response = await client.post(
        "/api/sales/v1/research/sales-job-7002/feedback",
        json={"rating": rating},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    assert response.status_code == 422


async def test_research_feedback_requires_a_rating(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    """A comment on its own is not enough — the rating is the mandatory part."""
    response = await client.post(
        "/api/sales/v1/research/sales-job-7002/feedback",
        json={"feedback": "Good brief."},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    assert response.status_code == 422


async def test_research_feedback_rejects_unknown_fields(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    """The schema is `extra="forbid"` upstream."""
    response = await client.post(
        "/api/sales/v1/research/sales-job-7002/feedback",
        json={"rating": 5, "feedback": "Good brief.", "stars": 5},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )
    assert response.status_code == 422


async def test_feedback_path_is_not_mistaken_for_a_cancel(
    client: httpx.AsyncClient, signed_in: dict[str, object]
) -> None:
    """`research/{id}` would match `research/{id}/feedback` if ordered wrongly."""
    listed = (await client.get("/api/sales/v1/research/jobs")).json()
    before = {j["job_id"]: j["status"] for j in listed}

    await client.post(
        "/api/sales/v1/research/sales-job-7001/feedback",
        json={"rating": 5, "feedback": "Accurate and timely."},
        headers=same_origin_headers(str(signed_in["csrfToken"])),
    )

    after = {
        j["job_id"]: j["status"] for j in (await client.get("/api/sales/v1/research/jobs")).json()
    }
    assert after["sales-job-7001"] == before["sales-job-7001"]
