"""Verbatim port of ``mockTranslationSeed.ts`` and ``mockSalesSeed.ts``.

Fixture values are copied exactly. The frontend is coupled to the precise JSON
these emit, so a "tidied up" port produces failures that look like frontend bugs
(plan §12, mock fidelity drift).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any


def iso(moment: datetime) -> str:
    """JS ``Date.toISOString()``: always UTC, milliseconds, trailing Z."""
    stamp = moment.astimezone(UTC)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.") + f"{stamp.microsecond // 1000:03d}Z"


def now() -> datetime:
    return datetime.now(UTC)


def minutes_ago(m: float) -> str:
    return iso(now() - timedelta(minutes=m))


def hours_ago(h: float) -> str:
    return iso(now() - timedelta(hours=h))


def days_ago(d: float) -> str:
    return iso(now() - timedelta(days=d))


# ── Translation ──────────────────────────────────────────────────────────────


@dataclass
class MockTranslationJob:
    job_id: str
    batch_id: str
    filename: str
    source_language: str
    target_language: str
    domain: str
    status: str  # queued | processing | completed | failed | cancelled
    progress: float
    submitted_at: str
    completed_at: str | None = None
    error_message: str | None = None
    result: dict[str, Any] | None = None
    # Wall-clock deadlines replacing the TypeScript setTimeout calls.
    processing_at: float | None = None
    completed_deadline: float | None = None


def initial_translation_jobs() -> list[MockTranslationJob]:
    return [
        MockTranslationJob(
            job_id="trans-job-8901",
            batch_id="batch-8901",
            filename="Colt_Master_Services_Agreement_2026.docx",
            source_language="en",
            target_language="de",
            domain="legal",
            status="completed",
            progress=1.0,
            submitted_at=minutes_ago(25),
            completed_at=minutes_ago(24),
            error_message=None,
            result={
                "translated_document": {
                    "filename": "Colt_Master_Services_Agreement_2026_de.docx",
                    "format": "docx",
                    "content": None,
                    "download_url": "/api/translation/v1/jobs/trans-job-8901/file",
                },
                "metadata": {
                    "source_language": "en",
                    "target_language": "de",
                    "domain": "legal",
                    "model_used": "gemini-1.5-pro",
                    "model_version": "v1.2-legal-tuned",
                    "quality_score": 98,
                    "ab_test_variant": "variant-a",
                    "chunks_processed": 6,
                    "retry_attempts": 0,
                },
                "labels": {
                    "translation_intent": "contract_execution",
                    "processing_time_seconds": 4.8,
                    "token_count": 2150,
                    "cost_usd": 0.053,
                },
            },
        ),
        MockTranslationJob(
            job_id="trans-job-8902",
            batch_id="batch-8902",
            filename="Q3_Customer_Business_Review_Presentation.pdf",
            source_language="en",
            target_language="fr",
            domain="commercial",
            status="completed",
            progress=1.0,
            submitted_at=hours_ago(1.5),
            completed_at=hours_ago(1.4),
            error_message=None,
            result={
                "translated_document": {
                    "filename": "Q3_Customer_Business_Review_Presentation_fr.pdf",
                    "format": "pdf",
                    "content": None,
                    "download_url": "/api/translation/v1/jobs/trans-job-8902/file",
                },
                "metadata": {
                    "source_language": "en",
                    "target_language": "fr",
                    "domain": "commercial",
                    "model_used": "gemini-1.5-pro",
                    "model_version": "v1.2-commercial",
                    "quality_score": 96,
                    "ab_test_variant": "variant-b",
                    "chunks_processed": 8,
                    "retry_attempts": 0,
                },
                "labels": {
                    "translation_intent": "client_deck",
                    "processing_time_seconds": 6.2,
                    "token_count": 2840,
                    "cost_usd": 0.071,
                },
            },
        ),
        MockTranslationJob(
            job_id="trans-job-8903",
            batch_id="batch-8903",
            filename="Data_Center_Interconnect_Technical_Spec.docx",
            source_language="en",
            target_language="ja",
            domain="operations",
            status="completed",
            progress=1.0,
            submitted_at=days_ago(1),
            completed_at=days_ago(1),
            error_message=None,
            result={
                "translated_document": {
                    "filename": "Data_Center_Interconnect_Technical_Spec_ja.docx",
                    "format": "docx",
                    "content": None,
                    "download_url": "/api/translation/v1/jobs/trans-job-8903/file",
                },
                "metadata": {
                    "source_language": "en",
                    "target_language": "ja",
                    "domain": "operations",
                    "model_used": "gemini-1.5-pro",
                    "model_version": "v1.2-operations",
                    "quality_score": 94,
                    "ab_test_variant": "variant-a",
                    "chunks_processed": 12,
                    "retry_attempts": 0,
                },
                "labels": {
                    "translation_intent": "technical_spec",
                    "processing_time_seconds": 8.4,
                    "token_count": 3600,
                    "cost_usd": 0.090,
                },
            },
        ),
        MockTranslationJob(
            job_id="trans-job-8904",
            batch_id="batch-8904",
            filename="Global_Voice_SIP_Trunking_Rates_2026.xlsx",
            source_language="en",
            target_language="de",
            domain="finance",
            status="failed",
            progress=0.3,
            submitted_at=days_ago(2),
            completed_at=days_ago(2),
            error_message=(
                "Unsupported layout format: nested macro worksheets could not be parsed."
            ),
            result=None,
        ),
    ]


# ── Sales ────────────────────────────────────────────────────────────────────


@dataclass
class MockSalesJob:
    job_id: str
    company_name: str
    account_id: str
    status: str  # PENDING | QUEUED | PROCESSING | COMPLETED | FAILED | CANCELLED
    progress: float
    created_at: str
    completed_at: str | None = None
    error_message: str | None = None
    report_content: str | None = None
    model_card: dict[str, Any] | None = field(default=None)
    processing_at: float | None = None
    completed_deadline: float | None = None


def initial_sales_jobs() -> list[MockSalesJob]:
    from app.proxy.mock.reports import DEUTSCHE_TELEKOM_REPORT, VODAFONE_REPORT

    return [
        MockSalesJob(
            job_id="sales-job-7001",
            company_name="Vodafone Group Plc",
            account_id="ACC-VOD-8821",
            status="COMPLETED",
            progress=1.0,
            created_at=minutes_ago(40),
            completed_at=minutes_ago(39),
            error_message=None,
            model_card={
                "model_version": "gemini-2.5-pro",
                "latency_seconds": 24.5,
                "tokens_used": 18450,
                "cost_usd": 0.185,
            },
            report_content=VODAFONE_REPORT,
        ),
        MockSalesJob(
            job_id="sales-job-7002",
            company_name="Deutsche Telekom AG",
            account_id="ACC-DT-4412",
            status="COMPLETED",
            progress=1.0,
            created_at=hours_ago(2),
            completed_at=hours_ago(1.9),
            error_message=None,
            model_card={
                "model_version": "gemini-2.5-pro",
                "latency_seconds": 21.0,
                "tokens_used": 15200,
                "cost_usd": 0.152,
            },
            report_content=DEUTSCHE_TELEKOM_REPORT,
        ),
        MockSalesJob(
            job_id="sales-job-7003",
            company_name="Santander Consumer Finance",
            account_id="ACC-SAN-5521",
            status="FAILED",
            progress=0.2,
            created_at=days_ago(3),
            completed_at=days_ago(3),
            error_message=(
                "Public intelligence extraction failed: target company filings could not "
                "be verified in the public registry."
            ),
            report_content=None,
            model_card=None,
        ),
    ]
