// ── Sales Agent Types ──────────────────────────────────────────────────────

export interface SalesAuthUser {
  email: string;
  business_unit: string;
  organization: string;
}

export interface SalesTokenResponse {
  access_token: string;
  token_type: string;
  email: string;
}

export interface InitiateResearchResponse {
  job_id: string;
  status: string;
  [key: string]: unknown;
}

/**
 * Research run statuses, as emitted by the Sales Agent service (uppercase,
 * unlike Translation's lowercase set). `CANCELLED` is returned after
 * `DELETE /research/{job_id}` and was previously missing here, so the two
 * frontend spellings of this union disagreed.
 */
export type SalesJobStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ResearchStatusResponse {
  job_id: string;
  status: SalesJobStatus;
  [key: string]: unknown;
}

/** Cost & model metadata for a completed research run (backend `model_card`). */
export interface ResearchModelCard {
  model_version?: string | null;
  tokens_used?: number | null;
  latency_seconds?: number | null;
  cost_usd?: number | null;
}

export interface ResearchResultResponse {
  job_id: string;
  /** Backend uses `request_id`; kept alongside job_id for compatibility. */
  request_id?: string;
  status: string;
  /** Canonical field returned by the backend (FastAPI `ResearchResultResponse`). */
  report_content?: string;
  /** Legacy alias — no longer emitted by the backend; kept for compatibility. */
  report_markdown?: string;
  model_card?: ResearchModelCard | null;
  [key: string]: unknown;
}

/**
 * One entry from the research job history.
 */
export interface ResearchJobListItem {
  job_id: string;
  status: string;
  company_name?: string | null;
  company?: string | null;
  account_id?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  progress?: number | null;
}

/**
 * `POST /research/{job_id}/feedback` — free text only.
 *
 * Deliberately unlike Translation's review, which is a 1-5 rating plus an
 * optional comment: the research service has no rating field, so there is
 * nothing for stars to submit. `extra="forbid"` upstream means sending one
 * anyway would 422.
 */
export interface ResearchFeedbackRequest {
  /** 1-1000 characters, enforced by the service. */
  feedback: string;
}

export interface ResearchFeedbackResponse {
  job_id: string;
  status: string;
  message: string;
}
