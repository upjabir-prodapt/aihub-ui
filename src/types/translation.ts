export interface TranslateRequest {
  file: File | string;
  text?: string;
  target_lang: string;
  source_lang?: string;
  domain: string;
  user_id: string;
  business_unit: string;
  organization: string;
  enable_dlp: boolean;
  enable_chunking: boolean;
  priority: string;
}

export interface TranslateResponse {
  job_id: string;
  status: string;
  status_url: string;
}

export interface TranslationResult {
  translated_document?: {
    content: string;
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

export interface JobStatusResponse {
  job_id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  submitted_at: string;
  completed_at?: string;
  result?: TranslationResult;
  error_message?: string;
}
