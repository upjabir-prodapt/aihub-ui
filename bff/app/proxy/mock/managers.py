"""Port of ``mockTranslationManager.ts``, ``mockSalesManager.ts`` and ``mockDb.ts``.

One behavioural difference from the TypeScript original, deliberately: the TS
version drove state transitions with ``setTimeout``, which only fires while the
dev server is alive. Here each job carries wall-clock deadlines and
``_advance()`` applies them lazily on read. The observable timeline is identical
(queued -> processing at 1.5 s -> completed at 4.5 s) but it survives a reload
and is trivially testable by moving the clock.
"""

from __future__ import annotations

import random
import time
from typing import Any

from app.proxy.mock.reports import generate_custom_report
from app.proxy.mock.seed import (
    MockSalesJob,
    MockTranslationJob,
    initial_sales_jobs,
    initial_translation_jobs,
    iso,
    now,
)

PROCESSING_DELAY_SECONDS = 1.5
COMPLETION_DELAY_SECONDS = 4.5

MOCK_USER_EMAIL = "dev@colt.net"
MOCK_USER_DEPARTMENT = "Technology & Operations"


def _base36(value: int) -> str:
    """JS ``Number.prototype.toString(36)`` for non-negative integers."""
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    out = ""
    while value:
        value, rem = divmod(value, 36)
        out = digits[rem] + out
    return out


def _now_base36() -> str:
    return _base36(int(time.time() * 1000))


def _rand_suffix() -> str:
    return "".join(random.choice("0123456789abcdefghijklmnopqrstuvwxyz") for _ in range(4))  # noqa: S311


# ── Translation ──────────────────────────────────────────────────────────────


class MockTranslationManager:
    def __init__(self) -> None:
        self.jobs: list[MockTranslationJob] = initial_translation_jobs()
        self.reviews: list[dict[str, Any]] = []

    def _advance(self) -> None:
        clock = time.monotonic()
        for job in self.jobs:
            if job.status == "queued" and job.processing_at and clock >= job.processing_at:
                job.status = "processing"
                job.progress = 0.45
            if (
                job.status in {"queued", "processing"}
                and job.completed_deadline
                and clock >= job.completed_deadline
            ):
                self._complete(job)

    def _complete(self, job: MockTranslationJob) -> None:
        filename = job.filename
        extension = filename.rsplit(".", 1)[-1] if "." in filename else "txt"
        base_name = filename.rsplit(".", 1)[0] if "." in filename else filename

        job.status = "completed"
        job.progress = 1.0
        job.completed_at = iso(now())
        job.result = {
            "translated_document": {
                "filename": f"{base_name}_{job.target_language}.{extension}",
                "format": extension,
                "content": None,
                "download_url": f"/api/translation/v1/jobs/{job.job_id}/file",
            },
            "metadata": {
                "source_language": job.source_language,
                "target_language": job.target_language,
                "domain": job.domain,
                "model_used": "gemini-1.5-pro",
                "model_version": f"v1.2-{job.domain}",
                "quality_score": random.randint(0, 4) + 94,  # noqa: S311
                "ab_test_variant": "variant-a",
                "chunks_processed": 6,
                "retry_attempts": 0,
            },
            "labels": {
                "translation_intent": f"{job.domain}_translation",
                "processing_time_seconds": round(random.random() * 3 + 3.2, 1),  # noqa: S311
                "token_count": int(random.random() * 1500 + 1200),  # noqa: S311
                "cost_usd": round(random.random() * 0.04 + 0.03, 3),  # noqa: S311
            },
        }

    def _find(self, job_id: str) -> MockTranslationJob | None:
        return next((j for j in self.jobs if j.job_id == job_id), None)

    def get_jobs(self) -> list[dict[str, Any]]:
        self._advance()
        return [
            {
                "job_id": j.job_id,
                "status": j.status,
                "progress": j.progress,
                "current_stage": (
                    "Completed"
                    if j.status == "completed"
                    else "Translating"
                    if j.status == "processing"
                    else "Queued"
                ),
                "user": MOCK_USER_EMAIL,
                "department": MOCK_USER_DEPARTMENT,
                "created_at": j.submitted_at,
                "updated_at": j.completed_at or j.submitted_at,
                "completed_at": j.completed_at,
                "download_url": ((j.result or {}).get("translated_document") or {}).get(
                    "download_url"
                ),
                "error_message": j.error_message,
                "filename": j.filename,
                "source_language": j.source_language,
                "target_language": j.target_language,
            }
            for j in self.jobs
        ]

    def get_job_status(self, job_id: str) -> dict[str, Any] | None:
        self._advance()
        job = self._find(job_id)
        if job is None:
            return None
        return {
            "job_id": job.job_id,
            "status": job.status,
            "submitted_at": job.submitted_at,
            "completed_at": job.completed_at,
            "result": job.result,
            "error_message": job.error_message,
        }

    def get_multiple_statuses(self, job_ids: list[str]) -> list[dict[str, Any]]:
        self._advance()
        out: list[dict[str, Any]] = []
        for job_id in job_ids:
            job = self._find(job_id)
            if job is None:
                out.append(
                    {
                        "job_id": job_id,
                        "target_language": "en",
                        "status": "failed",
                        "error_message": "Job not found",
                    }
                )
                continue
            document = (job.result or {}).get("translated_document") or {}
            out.append(
                {
                    "job_id": job.job_id,
                    "target_language": job.target_language,
                    "status": job.status,
                    "download_url": document.get("download_url"),
                    "download_filename": document.get("filename"),
                    "error_message": job.error_message,
                }
            )
        return out

    def create_jobs(
        self,
        filename: str,
        source_language: str,
        target_languages: list[str],
        domain: str,
    ) -> dict[str, Any]:
        batch_id = f"batch-{_now_base36()}"
        created: list[MockTranslationJob] = []
        clock = time.monotonic()

        for target_lang in target_languages:
            job = MockTranslationJob(
                job_id=f"trans-job-{_now_base36()}-{_rand_suffix()}",
                batch_id=batch_id,
                filename=filename,
                source_language=source_language or "en",
                target_language=target_lang,
                domain=domain or "commercial",
                status="queued",
                progress=0.1,
                submitted_at=iso(now()),
                completed_at=None,
                error_message=None,
                result=None,
                processing_at=clock + PROCESSING_DELAY_SECONDS,
                completed_deadline=clock + COMPLETION_DELAY_SECONDS,
            )
            self.jobs.insert(0, job)
            created.append(job)

        return {
            "batch_id": batch_id,
            "jobs": [
                {
                    "job_id": j.job_id,
                    "target_language": j.target_language,
                    "status": j.status,
                    "status_url": f"/api/v1/translate/{j.job_id}",
                }
                for j in created
            ],
        }

    def cancel_job(self, job_id: str) -> bool:
        job = self._find(job_id)
        if job is None:
            return False
        job.status = "cancelled"
        job.completed_at = iso(now())
        job.processing_at = None
        job.completed_deadline = None
        return True

    def add_review(self, job_id: str, rating: int, comment: str | None = None) -> dict[str, Any]:
        stamp = iso(now())
        review = {
            "review_id": f"rev-{_now_base36()}",
            "job_id": job_id,
            "rating": rating,
            "comment": comment,
            "reviewer_email": MOCK_USER_EMAIL,
            "created_at": stamp,
            "updated_at": stamp,
        }
        self.reviews.append(review)
        return review


# ── Sales ────────────────────────────────────────────────────────────────────


class MockSalesManager:
    def __init__(self) -> None:
        self.jobs: list[MockSalesJob] = initial_sales_jobs()

    def _advance(self) -> None:
        clock = time.monotonic()
        for job in self.jobs:
            if job.status == "PENDING" and job.processing_at and clock >= job.processing_at:
                job.status = "PROCESSING"
                job.progress = 0.5
            if (
                job.status in {"PENDING", "PROCESSING"}
                and job.completed_deadline
                and clock >= job.completed_deadline
            ):
                job.status = "COMPLETED"
                job.progress = 1.0
                job.completed_at = iso(now())
                job.model_card = {
                    "model_version": "gemini-2.5-pro",
                    "latency_seconds": round(random.random() * 8 + 16, 1),  # noqa: S311
                    "tokens_used": int(random.random() * 5000 + 14000),  # noqa: S311
                    "cost_usd": round(random.random() * 0.08 + 0.12, 3),  # noqa: S311
                }
                job.report_content = generate_custom_report(job.company_name, job.account_id)

    def _find(self, job_id: str) -> MockSalesJob | None:
        return next((j for j in self.jobs if j.job_id == job_id), None)

    def get_jobs(self) -> list[dict[str, Any]]:
        self._advance()
        return [
            {
                "job_id": j.job_id,
                "company_name": j.company_name,
                "company": j.company_name,
                "account_id": j.account_id,
                "status": j.status,
                "progress": j.progress,
                "created_at": j.created_at,
                "completed_at": j.completed_at,
                "error_message": j.error_message,
            }
            for j in self.jobs
        ]

    def get_status(self, job_id: str) -> dict[str, Any] | None:
        self._advance()
        job = self._find(job_id)
        if job is None:
            return None
        return {
            "job_id": job.job_id,
            "status": job.status,
            "error_message": job.error_message,
        }

    def get_result(self, job_id: str) -> dict[str, Any] | None:
        self._advance()
        job = self._find(job_id)
        if job is None:
            return None
        return {
            "job_id": job.job_id,
            "request_id": job.job_id,
            "status": job.status,
            "report_content": job.report_content,
            "model_card": job.model_card,
        }

    def initiate_research(self, company_name: str, account_id: str) -> dict[str, Any]:
        job_id = f"sales-job-{_now_base36()}-{_rand_suffix()}"
        clock = time.monotonic()
        job = MockSalesJob(
            job_id=job_id,
            company_name=company_name,
            account_id=account_id or f"ACC-{company_name[:3].upper()}-101",
            status="PENDING",
            progress=0.1,
            created_at=iso(now()),
            completed_at=None,
            error_message=None,
            report_content=None,
            model_card=None,
            processing_at=clock + PROCESSING_DELAY_SECONDS,
            completed_deadline=clock + COMPLETION_DELAY_SECONDS,
        )
        self.jobs.insert(0, job)
        return {"job_id": job_id, "status": "PENDING"}

    def cancel_research(self, job_id: str) -> bool:
        job = self._find(job_id)
        if job is None:
            return False
        job.status = "CANCELLED"
        job.completed_at = iso(now())
        job.processing_at = None
        job.completed_deadline = None
        return True


class MockDatabase:
    """Port of ``mockDb.ts``. One instance per BFF process."""

    def __init__(self) -> None:
        self.translation = MockTranslationManager()
        self.sales = MockSalesManager()

    def reset(self) -> None:
        self.translation = MockTranslationManager()
        self.sales = MockSalesManager()
