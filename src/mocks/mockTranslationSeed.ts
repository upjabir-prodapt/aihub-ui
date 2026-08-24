import type { TranslationResult } from '../types/translation.ts';


export interface MockTranslationJob {
  job_id: string;
  batch_id: string;
  filename: string;
  source_language: string;
  target_language: string;
  domain: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  submitted_at: string;
  completed_at: string | null;
  error_message: string | null;
  result: TranslationResult | null;
}

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86400 * 1000).toISOString();

export const INITIAL_TRANSLATION_JOBS: MockTranslationJob[] = [
  {
    job_id: 'trans-job-8901',
    batch_id: 'batch-8901',
    filename: 'Colt_Master_Services_Agreement_2026.docx',
    source_language: 'en',
    target_language: 'de',
    domain: 'legal',
    status: 'completed',
    progress: 1.0,
    submitted_at: minutesAgo(25),
    completed_at: minutesAgo(24),
    error_message: null,
    result: {
      translated_document: {
        filename: 'Colt_Master_Services_Agreement_2026_de.docx',
        format: 'docx',
        content: null,
        download_url: '/api/translation/v1/jobs/trans-job-8901/file',
      },
      metadata: {
        source_language: 'en',
        target_language: 'de',
        domain: 'legal',
        model_used: 'gemini-1.5-pro',
        model_version: 'v1.2-legal-tuned',
        quality_score: 98,
        ab_test_variant: 'variant-a',
        chunks_processed: 6,
        retry_attempts: 0,
      },
      labels: {
        translation_intent: 'contract_execution',
        processing_time_seconds: 4.8,
        token_count: 2150,
        cost_usd: 0.053,
      },
    },
  },
  {
    job_id: 'trans-job-8902',
    batch_id: 'batch-8902',
    filename: 'Q3_Customer_Business_Review_Presentation.pdf',
    source_language: 'en',
    target_language: 'fr',
    domain: 'commercial',
    status: 'completed',
    progress: 1.0,
    submitted_at: hoursAgo(1.5),
    completed_at: hoursAgo(1.4),
    error_message: null,
    result: {
      translated_document: {
        filename: 'Q3_Customer_Business_Review_Presentation_fr.pdf',
        format: 'pdf',
        content: null,
        download_url: '/api/translation/v1/jobs/trans-job-8902/file',
      },
      metadata: {
        source_language: 'en',
        target_language: 'fr',
        domain: 'commercial',
        model_used: 'gemini-1.5-pro',
        model_version: 'v1.2-commercial',
        quality_score: 96,
        ab_test_variant: 'variant-b',
        chunks_processed: 8,
        retry_attempts: 0,
      },
      labels: {
        translation_intent: 'client_deck',
        processing_time_seconds: 6.2,
        token_count: 2840,
        cost_usd: 0.071,
      },
    },
  },
  {
    job_id: 'trans-job-8903',
    batch_id: 'batch-8903',
    filename: 'Data_Center_Interconnect_Technical_Spec.docx',
    source_language: 'en',
    target_language: 'ja',
    domain: 'operations',
    status: 'completed',
    progress: 1.0,
    submitted_at: daysAgo(1),
    completed_at: daysAgo(1),
    error_message: null,
    result: {
      translated_document: {
        filename: 'Data_Center_Interconnect_Technical_Spec_ja.docx',
        format: 'docx',
        content: null,
        download_url: '/api/translation/v1/jobs/trans-job-8903/file',
      },
      metadata: {
        source_language: 'en',
        target_language: 'ja',
        domain: 'operations',
        model_used: 'gemini-1.5-pro',
        model_version: 'v1.2-operations',
        quality_score: 94,
        ab_test_variant: 'variant-a',
        chunks_processed: 12,
        retry_attempts: 0,
      },
      labels: {
        translation_intent: 'technical_spec',
        processing_time_seconds: 8.4,
        token_count: 3600,
        cost_usd: 0.090,
      },
    },
  },
  {
    job_id: 'trans-job-8904',
    batch_id: 'batch-8904',
    filename: 'Global_Voice_SIP_Trunking_Rates_2026.xlsx',
    source_language: 'en',
    target_language: 'de',
    domain: 'finance',
    status: 'failed',
    progress: 0.3,
    submitted_at: daysAgo(2),
    completed_at: daysAgo(2),
    error_message: 'Unsupported layout format: nested macro worksheets could not be parsed.',
    result: null,
  },
];
