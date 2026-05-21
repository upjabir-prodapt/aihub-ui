// ── Request ────────────────────────────────────────────────────────────────

export interface TranslateRequest {
  file: File;
  /** Full name or ISO 639-1 code e.g. "French" or "fr" */
  target_language: string;
  domain: string;
  source_language?: string;
  enable_dlp?: boolean;
  enable_chunking?: boolean;
  /** "standard" | "high" */
  priority?: string;
}

// ── Submit response ────────────────────────────────────────────────────────

export interface TranslateResponse {
  job_id: string;
  status: string; // "queued"
  status_url: string;
}

// ── Result detail (GET /translate/{job_id}) ───────────────────────────────

export interface TranslationResultDetail {
  translated_document?: {
    content: string | null;
    format: string | null;
    filename: string | null;
    download_url: string | null;
  };
  metadata?: {
    source_language: string;
    target_language: string;
    domain: string;
    model_used: string;
    model_version: string;
    quality_score: number;
    ab_test_variant: string;
    chunks_processed: number;
    retry_attempts: number;
  };
  labels?: {
    translation_intent: string;
    processing_time_seconds: number;
    token_count: number;
    cost_usd: number;
  };
}

export interface JobDetailResponse {
  job_id: string;
  status: JobStatus;
  submitted_at: string | null;
  completed_at: string | null;
  result?: TranslationResultDetail | null;
  error_message?: string | null;
}

// ── Lightweight status (GET /jobs/{job_id}) ────────────────────────────────

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  progress: number;
  current_stage: string | null;
  user: string;
  department: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  download_url: string | null;
  error_message: string | null;
}

// ── Jobs list (GET /jobs) ──────────────────────────────────────────────────

export interface JobsListResponse {
  jobs: JobStatusResponse[];
  total: number;
  limit: number;
  offset: number;
}

// ── Download URL (GET /jobs/{job_id}/download) ─────────────────────────────

export interface DownloadUrlResponse {
  download_url: string;
  expires_in: number;
  filename: string;
  file_size: number | null;
}
