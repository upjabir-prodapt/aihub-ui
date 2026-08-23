import { useState, useCallback, useRef, useEffect } from 'react';
import { translationApi } from '../api/translationApi';
import type {
  JobStatusResponse,
  DownloadUrlResponse,
  MultiTranslateResponse,
  MultiJobStatusItem,
} from '../types/translation';

export type TranslationStatus =
  | 'idle'
  | 'submitting'
  | 'polling'
  | 'completed'
  | 'failed'
  | 'partial';

// ── Retry helper ───────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry `fn` up to `maxAttempts` times with exponential back-off.
 * Each attempt calls `fn()` fresh — important for FormData factories.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await delay(baseMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export const useTranslation = () => {
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobStatusResponse>>({});
  const [jobOrder, setJobOrder] = useState<string[]>([]);
  const [downloadInfo, setDownloadInfo] = useState<Record<string, DownloadUrlResponse>>({});
  const [error, setError] = useState<string | null>(null);

  const pollingIntervalRef = useRef<number | null>(null);
  /** Number of consecutive polling failures; resets to 0 on a successful poll. */
  const pollErrorCountRef = useRef<number>(0);
  /**
   * Session generation counter. Incremented on every new polling session.
   * In-flight callbacks from previous sessions check their captured generation
   * against this ref and bail if stale.
   */
  const sessionGenRef = useRef<number>(0);
  /** Mounted flag to prevent setState after unmount. */
  const isMountedRef = useRef<boolean>(true);
  /** When each download URL was last fetched (ms since epoch). */
  const downloadFetchedAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  /**
   * Derive the overall status from a map of per-job statuses.
   */
  const deriveOverallStatus = useCallback((
    jobMap: Record<string, JobStatusResponse>,
  ): TranslationStatus => {
    const values = Object.values(jobMap);
    if (values.length === 0) return 'polling';

    const allCompleted = values.every((j) => j.status === 'completed');
    if (allCompleted) return 'completed';

    const terminal = values.filter(
      (j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled',
    );
    if (terminal.length === values.length) {
      const anyCompleted = terminal.some((j) => j.status === 'completed');
      return anyCompleted ? 'partial' : 'failed';
    }

    return 'polling';
  }, []);

  /**
   * Fetch a fresh signed download URL for a specific job and cache it.
   */
  const fetchDownloadUrl = useCallback(async (jobId: string) => {
    try {
      const info = await translationApi.getDownloadUrl(jobId);
      if (!isMountedRef.current) return;
      setDownloadInfo((prev) => ({ ...prev, [jobId]: info }));
      downloadFetchedAtRef.current[jobId] = Date.now();
    } catch (err) {
      console.warn(`Could not fetch signed download URL for ${jobId}:`, err);
    }
  }, []);

  /**
   * Fetch full job details for completed jobs so we can display metadata
   * (model, cost, tokens, etc.) that the batch status endpoint omits.
   */
  const fetchJobDetails = useCallback(async (jobId: string) => {
    try {
      const data = await translationApi.getJobStatus(jobId);
      if (!isMountedRef.current) return;
      setJobs((prev) => ({ ...prev, [jobId]: data }));
      if (data.status === 'completed' && data.result?.translated_document?.download_url) {
        await fetchDownloadUrl(jobId);
      }
    } catch (err) {
      console.warn(`Could not fetch job details for ${jobId}:`, err);
    }
  }, [fetchDownloadUrl]);

  /**
   * Returns a guaranteed-valid download URL for a job, re-fetching if expired.
   */
  const getValidDownloadUrl = useCallback(async (jobId: string): Promise<string | null> => {
    const cached = downloadInfo[jobId];
    if (cached) {
      const ageMs = Date.now() - (downloadFetchedAtRef.current[jobId] ?? 0);
      const expiresInMs = cached.expires_in * 1000;
      if (ageMs < expiresInMs - 60_000) {
        return cached.download_url;
      }
    }

    try {
      const info = await translationApi.getDownloadUrl(jobId);
      if (isMountedRef.current) {
        setDownloadInfo((prev) => ({ ...prev, [jobId]: info }));
        downloadFetchedAtRef.current[jobId] = Date.now();
      }
      return info.download_url;
    } catch {
      return cached?.download_url ?? jobs[jobId]?.result?.translated_document?.download_url ?? null;
    }
  }, [downloadInfo, jobs]);

  /**
   * Single batch poll tick.
   */
  const pollBatchStatus = useCallback(async (jobIds: string[], myGen: number) => {
    if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

    try {
      const { jobs: statusItems } = await translationApi.getMultipleJobStatuses(jobIds);

      if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

      pollErrorCountRef.current = 0;

      // Merge statuses into existing job records
      setJobs((prev) => {
        const next = { ...prev };
        for (const item of statusItems) {
          const existing = next[item.job_id];
          next[item.job_id] = {
            ...existing,
            job_id: item.job_id,
            status: item.status,
            error_message: item.error_message ?? existing?.error_message ?? null,
            // Preserve timestamps/details from a previous full fetch if present
            submitted_at: existing?.submitted_at ?? '',
            completed_at: item.status === 'completed' ? (existing?.completed_at ?? new Date().toISOString()) : existing?.completed_at ?? null,
            result: existing?.result ?? undefined,
          };
        }
        return next;
      });

      // For completed jobs without full details, fetch them in parallel.
      const completedWithoutDetails = statusItems.filter(
        (item) => item.status === 'completed' && !jobs[item.job_id]?.result,
      );
      await Promise.all(completedWithoutDetails.map((item) => fetchJobDetails(item.job_id)));

      if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

      setJobs((current) => {
        const newStatus = deriveOverallStatus(current);
        setStatus(newStatus);

        if (newStatus !== 'polling' && newStatus !== 'submitting') {
          clearPolling();
        }
        return current;
      });
    } catch (err: unknown) {
      if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

      pollErrorCountRef.current += 1;
      console.warn(`Batch polling error (attempt ${pollErrorCountRef.current}):`, err);

      if (pollErrorCountRef.current >= 3) {
        clearPolling();
        setStatus('failed');
        setError(err instanceof Error ? err.message : 'Error checking job status.');
      }
    }
  }, [clearPolling, deriveOverallStatus, fetchJobDetails, jobs]);

  /**
   * Begin polling a batch of job IDs.
   */
  const startPolling = useCallback((jobIds: string[]) => {
    clearPolling();
    pollErrorCountRef.current = 0;

    const myGen = sessionGenRef.current + 1;
    sessionGenRef.current = myGen;

    setStatus('polling');

    pollingIntervalRef.current = window.setInterval(() => {
      pollBatchStatus(jobIds, myGen);
    }, 3000);

    pollBatchStatus(jobIds, myGen);
  }, [clearPolling, pollBatchStatus]);

  /**
   * Submit a new translation batch. Accepts a FormData factory so retries
   * can build fresh FormData objects with unconsumed file streams.
   */
  const startTranslation = useCallback(async (buildFormData: () => FormData) => {
    setStatus('submitting');
    setError(null);
    setBatchId(null);
    setJobs({});
    setJobOrder([]);
    setDownloadInfo({});
    downloadFetchedAtRef.current = {};
    sessionGenRef.current += 1;
    clearPolling();

    try {
      const startData: MultiTranslateResponse = await withRetry(
        () => translationApi.startTranslation(buildFormData()),
        3,
        1000,
      );

      if (!isMountedRef.current) return;

      setBatchId(startData.batch_id);

      const initialJobs: Record<string, JobStatusResponse> = {};
      const order: string[] = [];
      for (const job of startData.jobs) {
        initialJobs[job.job_id] = {
          job_id: job.job_id,
          status: 'queued',
          submitted_at: new Date().toISOString(),
          completed_at: null,
          error_message: null,
        };
        order.push(job.job_id);
      }
      setJobs(initialJobs);
      setJobOrder(order);

      startPolling(order);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Failed to start translation job.');
    }
  }, [clearPolling, startPolling]);

  /**
   * Rehydrate a previously-submitted batch (e.g. after a page refresh) from
   * a live status snapshot already fetched by the caller, then resume
   * polling any non-terminal jobs. Used by TranslationJobsProvider's
   * resume-on-mount flow -- the caller is responsible for having already
   * re-validated the batch against the backend (ownership + freshness);
   * this function only rehydrates local state and (re)starts polling.
   */
  const resumeBatch = useCallback((
    resumedBatchId: string,
    order: string[],
    statusItems: MultiJobStatusItem[],
    /**
     * When the batch was originally submitted, from the persisted record.
     * Without it these jobs carry no timestamp and sort to the bottom of any
     * newest-first list — putting a still-running job below finished history.
     */
    submittedAt?: string,
  ) => {
    if (!isMountedRef.current) return;

    const resumedSubmittedAt = submittedAt ?? new Date().toISOString();

    const rehydratedJobs: Record<string, JobStatusResponse> = {};
    for (const item of statusItems) {
      rehydratedJobs[item.job_id] = {
        job_id: item.job_id,
        status: item.status,
        submitted_at: resumedSubmittedAt,
        completed_at: item.status === 'completed' ? new Date().toISOString() : null,
        error_message: item.error_message ?? null,
      };
    }

    setBatchId(resumedBatchId);
    setJobs(rehydratedJobs);
    setJobOrder(order);
    setError(null);

    const nonTerminal = statusItems
      .filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status))
      .map((item) => item.job_id);

    if (nonTerminal.length > 0) {
      startPolling(nonTerminal);
    } else {
      setStatus(deriveOverallStatus(rehydratedJobs));
    }
  }, [startPolling, deriveOverallStatus]);

  /**
   * Retry: if a batch exists, resume polling any non-terminal jobs.
   * Otherwise reset to idle for a fresh submit.
   */
  const retryOrReset = useCallback(() => {
    const remaining = Object.values(jobs)
      .filter((j) => j.status !== 'completed' && j.status !== 'failed' && j.status !== 'cancelled')
      .map((j) => j.job_id);

    if (remaining.length > 0) {
      setError(null);
      startPolling(remaining);
    } else {
      sessionGenRef.current += 1;
      setStatus('idle');
      setBatchId(null);
      setJobs({});
      setJobOrder([]);
      setDownloadInfo({});
      setError(null);
      downloadFetchedAtRef.current = {};
      clearPolling();
    }
  }, [jobs, startPolling, clearPolling]);

  /**
   * Cancel a single job (Job Tracker's Cancel action). Calls the backend's
   * DELETE /jobs/{id} and reflects the cancellation locally so the UI updates
   * immediately without waiting for the next poll tick.
   */
  const cancelJob = useCallback(async (jobId: string) => {
    await translationApi.cancelJob(jobId);
    if (!isMountedRef.current) return;
    setJobs((prev) => {
      const existing = prev[jobId];
      if (!existing) return prev;
      return {
        ...prev,
        [jobId]: {
          ...existing,
          status: 'cancelled',
          completed_at: existing.completed_at ?? new Date().toISOString(),
        },
      };
    });
  }, []);

  /** Full reset — clears all state and cancels any in-flight work. */
  const reset = useCallback(() => {
    sessionGenRef.current += 1;
    setStatus('idle');
    setBatchId(null);
    setJobs({});
    setJobOrder([]);
    setDownloadInfo({});
    setError(null);
    downloadFetchedAtRef.current = {};
    clearPolling();
  }, [clearPolling]);

  // Clean up on unmount
  useEffect(() => {
    return () => clearPolling();
  }, [clearPolling]);

  return {
    status,
    batchId,
    jobs,
    jobOrder,
    downloadInfo,
    error,
    startTranslation,
    resumeBatch,
    retryOrReset,
    reset,
    getValidDownloadUrl,
    cancelJob,
  };
};
