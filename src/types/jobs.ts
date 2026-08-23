/** Cross-service job status, normalized for the Service Hub / Job Tracker UI. */
export type UnifiedJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

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
  startedBy: string | null;
}
