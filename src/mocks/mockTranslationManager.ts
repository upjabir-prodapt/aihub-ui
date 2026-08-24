import type {
  LegacyJobStatusResponse,
  JobStatusResponse,
  MultiJobStatusItem,
  ReviewResponse,
} from '../types/translation.ts';
import { INITIAL_TRANSLATION_JOBS, type MockTranslationJob } from './mockTranslationSeed.ts';


export class MockTranslationManager {
  private jobs: MockTranslationJob[] = [...INITIAL_TRANSLATION_JOBS];
  private reviews: ReviewResponse[] = [];

  public getJobs(): LegacyJobStatusResponse[] {
    return this.jobs.map((j) => ({
      job_id: j.job_id,
      status: j.status,
      progress: j.progress,
      current_stage: j.status === 'completed' ? 'Completed' : j.status === 'processing' ? 'Translating' : 'Queued',
      user: 'dev@colt.net',
      department: 'Technology & Operations',
      created_at: j.submitted_at,
      updated_at: j.completed_at ?? j.submitted_at,
      completed_at: j.completed_at,
      download_url: j.result?.translated_document?.download_url ?? null,
      error_message: j.error_message,
      filename: j.filename,
      source_language: j.source_language,
      target_language: j.target_language,
    }));
  }

  public getJobStatus(jobId: string): JobStatusResponse | null {
    const job = this.jobs.find((j) => j.job_id === jobId);
    if (!job) return null;
    return {
      job_id: job.job_id,
      status: job.status,
      submitted_at: job.submitted_at,
      completed_at: job.completed_at,
      result: job.result,
      error_message: job.error_message,
    };
  }

  public getMultipleStatuses(jobIds: string[]): MultiJobStatusItem[] {
    return jobIds.map((id) => {
      const job = this.jobs.find((j) => j.job_id === id);
      if (!job) {
        return {
          job_id: id,
          target_language: 'en',
          status: 'failed' as const,
          error_message: 'Job not found',
        };
      }
      return {
        job_id: job.job_id,
        target_language: job.target_language,
        status: job.status,
        download_url: job.result?.translated_document?.download_url ?? null,
        download_filename: job.result?.translated_document?.filename ?? null,
        error_message: job.error_message,
      };
    });
  }

  public createJobs(
    filename: string,
    sourceLanguage: string,
    targetLanguages: string[],
    domain: string,
  ) {
    const batchId = `batch-${Date.now().toString(36)}`;
    const createdList: MockTranslationJob[] = [];

    for (const targetLang of targetLanguages) {
      const jobId = `trans-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const job: MockTranslationJob = {
        job_id: jobId,
        batch_id: batchId,
        filename,
        source_language: sourceLanguage || 'en',
        target_language: targetLang,
        domain: domain || 'commercial',
        status: 'queued',
        progress: 0.1,
        submitted_at: new Date().toISOString(),
        completed_at: null,
        error_message: null,
        result: null,
      };

      this.jobs.unshift(job);
      createdList.push(job);

      setTimeout(() => {
        const j = this.jobs.find((x) => x.job_id === jobId);
        if (j && j.status === 'queued') {
          j.status = 'processing';
          j.progress = 0.45;
        }
      }, 1500);

      setTimeout(() => {
        const j = this.jobs.find((x) => x.job_id === jobId);
        if (j && (j.status === 'processing' || j.status === 'queued')) {
          const extension = filename.includes('.') ? filename.split('.').pop() : 'txt';
          const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
          j.status = 'completed';
          j.progress = 1.0;
          j.completed_at = new Date().toISOString();
          j.result = {
            translated_document: {
              filename: `${baseName}_${targetLang}.${extension}`,
              format: extension ?? 'txt',
              content: null,
              download_url: `/api/translation/v1/jobs/${jobId}/file`,
            },
            metadata: {
              source_language: j.source_language,
              target_language: j.target_language,
              domain: j.domain,
              model_used: 'gemini-1.5-pro',
              model_version: `v1.2-${j.domain}`,
              quality_score: Math.floor(Math.random() * 5) + 94,
              ab_test_variant: 'variant-a',
              chunks_processed: 6,
              retry_attempts: 0,
            },
            labels: {
              translation_intent: `${j.domain}_translation`,
              processing_time_seconds: parseFloat((Math.random() * 3 + 3.2).toFixed(1)),
              token_count: Math.floor(Math.random() * 1500 + 1200),
              cost_usd: parseFloat((Math.random() * 0.04 + 0.03).toFixed(3)),
            },
          };
        }
      }, 4500);
    }

    return {
      batch_id: batchId,
      jobs: createdList.map((j) => ({
        job_id: j.job_id,
        target_language: j.target_language,
        status: j.status,
        status_url: `/api/v1/translate/${j.job_id}`,
      })),
    };
  }

  public cancelJob(jobId: string): boolean {
    const job = this.jobs.find((j) => j.job_id === jobId);
    if (!job) return false;
    job.status = 'cancelled';
    job.completed_at = new Date().toISOString();
    return true;
  }

  public addReview(jobId: string, rating: number, comment?: string): ReviewResponse {
    const review: ReviewResponse = {
      review_id: `rev-${Date.now().toString(36)}`,
      job_id: jobId,
      rating,
      comment: comment ?? null,
      reviewer_email: 'dev@colt.net',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.reviews.push(review);
    return review;
  }
}
