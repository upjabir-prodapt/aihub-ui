/** Cross-service job status, normalized for the Service Hub / Job Tracker UI. */
export type UnifiedJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Metadata only available from a job's full detail endpoint (e.g.
 * `GET /translate/{job_id}`), not the lighter-weight list/status endpoints.
 * Populated lazily — see `detailStatus`.
 */
export interface UnifiedJobDetail {
  costUsd: number | null;
  tokenCount: number | null;
  processingTimeSeconds: number | null;
  modelUsed: string | null;
  modelVersion: string | null;
  qualityScore: number | null;
  /** Full markdown report body — sales research jobs only; translation has no equivalent. */
  reportContent?: string | null;
}

export interface UnifiedJob {
  /** Stable key: `${service}:${id}`. */
  key: string;
  id: string;
  service: 'translation' | 'sales';
  serviceLabel: string;
  title: string;
  subtitle: string;
  status: UnifiedJobStatus;
  /** 0–100 when the backend reports a real number; null renders as indeterminate. */
  progress: number | null;
  createdAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  canCancel: boolean;
  canDownload: boolean;
  /** Completed translation jobs can be rated; other services have no review flow yet. */
  canReview: boolean;
  startedBy: string | null;
  /** Cost/tokens/time/model — present once fetched from the job's detail endpoint. */
  detail?: UnifiedJobDetail;
  /** Lazy-fetch state for `detail`, driven by row expansion in the UI. */
  detailStatus?: 'idle' | 'loading' | 'loaded' | 'error';
}

