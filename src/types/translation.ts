// ── Submit Translation Job ─────────────────────────────────────────────────
export interface TranslateRequest {
  file: File;
  target_languages: string[]; // 1–5 target language codes (e.g. ["de", "fr"])
  source_language?: string;   // Optional – auto-detected if omitted
  domain: string;             // "commercial" | "legal" | "finance" | "hr" | "operations"
  enable_dlp?: boolean;
  enable_chunking?: boolean;
  priority?: string;          // "standard" | "high"
}

// Hub browser path: /api/translation/v1/* → Translation backend /api/v1/*
//
// POST /api/translation/v1/translate → 202
export interface MultiTranslateJobResponse {
  job_id: string;
  target_language: string;
  status: string;
  status_url: string;
}

export interface MultiTranslateResponse {
  batch_id: string;
  jobs: MultiTranslateJobResponse[];
}

// POST /api/translation/v1/jobs/status → 200
export interface MultiJobStatusRequest {
  job_ids: string[];
}

export interface MultiJobStatusItem {
  job_id: string;
  target_language: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  download_url?: string | null;
  download_filename?: string | null;
  error_message?: string | null;
}

export interface MultiJobStatusResponse {
  jobs: MultiJobStatusItem[];
}

// ── Job result payload ─────────────────────────────────────────────────────
export interface TranslationResult {
  translated_document?: {
    content: string | null;
    format: string;
    filename: string;
    download_url: string;
  };
  metadata: {
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
  labels: {
    translation_intent: string;
    processing_time_seconds: number;
    token_count: number;
    cost_usd: number;
  };
}

// GET /api/v1/translate/{job_id} → 200
export interface JobStatusResponse {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  submitted_at: string;
  completed_at?: string | null;
  result?: TranslationResult | null;
  error_message?: string | null;
}

// GET /api/v1/jobs/{job_id} → 200  (legacy/alternative endpoint)
// Also used for items from the GET /jobs history list.
export interface LegacyJobStatusResponse {
  job_id: string;
  status: string;
  progress: number;
  current_stage: string;
  user: string;
  department: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  download_url: string | null;
  error_message: string | null;
  // Optional display fields. The exact history payload wasn't confirmed
  // against the live service, so the source filename is probed across the
  // plausible key names rather than assumed (see normalizeTranslationHistoryItem).
  filename?: string | null;
  file_name?: string | null;
  original_filename?: string | null;
  document_name?: string | null;
  source_language?: string | null;
  target_language?: string | null;
}

// GET /api/v1/jobs/{job_id}/download → 200
export interface DownloadUrlResponse {
  download_url: string;
  expires_in: number;
  filename: string;
  file_size: number;
}

// Standard error shape from the API
export interface ApiError {
  error: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
  };
}

// POST /api/v1/reviews/{job_id} → 201
export interface ReviewRequest {
  rating: number;   // 1–5
  comment?: string; // max 2000 chars
}

export interface ReviewResponse {
  review_id: string;
  job_id: string;
  rating: number;
  comment: string | null;
  reviewer_email: string;
  created_at: string;
  updated_at: string;
}
