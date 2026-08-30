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
  /**
   * Set when the backend reused an existing job instead of creating a new
   * one for this submission (implementation_plan.md D.5 / EC-15: a
   * double-click, or resubmitting the identical document+target+domain
   * within the idempotency window). Surfaced as a dismissible popup rather
   * than left invisible, so the user knows why nothing new was created.
   */
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const dismissDuplicateNotice = useCallback(() => setDuplicateNotice(null), []);
  /**
   * Set when a previously in-progress batch (persisted in localStorage
   * across a refresh/reopen) could not be resumed — the job no longer
   * exists, or ownership no longer resolves to this user
   * (implementation_plan.md D.1, Sev-1: GET /jobs/status enforces
   * ownership server-side and fails closed). Surfaced as a popup rather
   * than silently dropping the stale entry.
   */
  const [resumeFailedNotice, setResumeFailedNotice] = useState<string | null>(null);
  const dismissResumeFailedNotice = useCallback(() => setResumeFailedNotice(null), []);
  const reportResumeFailed = useCallback(() => {
    setResumeFailedNotice(
      "One of your previous translation jobs could no longer be found. " +
        'It may have finished, been removed, or is no longer accessible.',
    );
  }, []);

  const jobsRef = useRef<Record<string, JobStatusResponse>>({});
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const pollingIntervalRef = useRef<number | null>(null);
  /** Number of consecutive polling failures; resets to 0 on a successful poll. */
  const pollErrorCountRef = useRef<number>(0);
  /**
   * Session generation counter. Incremented on explicit full reset to invalidate
   * previous polling callbacks.
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
    if (pollingIntervalRef.current !== null) {
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
    if (values.length === 0) return 'idle';

    const hasActive = values.some(
      (j) => j.status === 'queued' || j.status === 'processing',
    );
    if (hasActive) return 'polling';

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
   * Single active-jobs poll tick. Polls the union of all active (queued/processing)
   * jobs across all batches submitted during this session.
   */
  const pollActiveJobs = useCallback(async (myGen: number) => {
    if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

    const currentJobs = jobsRef.current;
    const activeJobIds = Object.values(currentJobs)
      .filter((j) => j.status === 'queued' || j.status === 'processing')
      .map((j) => j.job_id);

    if (activeJobIds.length === 0) {
      clearPolling();
      if (isMountedRef.current) {
        setStatus(deriveOverallStatus(currentJobs));
      }
      return;
    }

    try {
      const { jobs: statusItems } = await translationApi.getMultipleJobStatuses(activeJobIds);

      if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

      pollErrorCountRef.current = 0;

      // Merge statuses into existing job records
      setJobs((prev) => {
        const next = { ...prev };
        for (const item of statusItems) {
          const existing = next[item.job_id];
          if (!existing) continue;
          next[item.job_id] = {
            ...existing,
            job_id: item.job_id,
            status: item.status,
            error_message: item.error_message ?? existing.error_message ?? null,
            submitted_at: existing.submitted_at ?? '',
            completed_at: item.status === 'completed'
              ? (existing.completed_at ?? new Date().toISOString())
              : existing.completed_at ?? null,
            result: existing.result ?? undefined,
          };
        }
        return next;
      });

      // For completed jobs without full details, fetch them in parallel.
      const completedWithoutDetails = statusItems.filter(
        (item) => item.status === 'completed' && !jobsRef.current[item.job_id]?.result,
      );
      if (completedWithoutDetails.length > 0) {
        void Promise.all(
          completedWithoutDetails.map((item) => fetchJobDetails(item.job_id)),
        );
      }

      setJobs((current) => {
        const newStatus = deriveOverallStatus(current);
        setStatus(newStatus);
        const hasRemainingActive = Object.values(current).some(
          (j) => j.status === 'queued' || j.status === 'processing',
        );
        if (!hasRemainingActive) {
          clearPolling();
        }
        return current;
      });
    } catch (err: unknown) {
      if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

      pollErrorCountRef.current += 1;
      console.warn(`Translation polling error (attempt ${pollErrorCountRef.current}):`, err);

      if (pollErrorCountRef.current >= 5) {
        clearPolling();
        setStatus('failed');
        setError(err instanceof Error ? err.message : 'Error checking job status.');
      }
    }
  }, [clearPolling, deriveOverallStatus, fetchJobDetails]);

  /**
   * Ensure polling is active for all current non-terminal jobs.
   */
  const ensurePolling = useCallback(() => {
    pollErrorCountRef.current = 0;
    setStatus('polling');

    const myGen = sessionGenRef.current;

    if (pollingIntervalRef.current === null) {
      pollingIntervalRef.current = window.setInterval(() => {
        void pollActiveJobs(myGen);
      }, 3000);
    }

    void pollActiveJobs(myGen);
  }, [pollActiveJobs]);

  /**
   * Submit a new translation batch. Merges new jobs with any existing tracked jobs
   * so multiple batches run and poll concurrently without cancelling or overwriting
   * previous batches.
   */
  const startTranslation = useCallback(async (buildFormData: () => FormData) => {
    setError(null);
    setStatus((prev) => (prev === 'idle' ? 'submitting' : prev));

    try {
      const startData: MultiTranslateResponse = await withRetry(
        () => translationApi.startTranslation(buildFormData()),
        3,
        1000,
      );

      if (!isMountedRef.current) return;

      setBatchId(startData.batch_id);

      const newJobs: Record<string, JobStatusResponse> = {};
      const newOrder: string[] = [];
      const submittedAt = new Date().toISOString();
      const duplicateCount = startData.jobs.filter((job) => job.is_duplicate).length;

      for (const job of startData.jobs) {
        newJobs[job.job_id] = {
          job_id: job.job_id,
          status: 'queued',
          submitted_at: submittedAt,
          completed_at: null,
          error_message: null,
        };
        newOrder.push(job.job_id);
      }

      setJobs((prev) => ({ ...prev, ...newJobs }));
      setJobOrder((prev) => {
        const set = new Set(prev);
        const filtered = newOrder.filter((id) => !set.has(id));
        return [...prev, ...filtered];
      });

      // Update ref immediately so pollActiveJobs sees new jobs on the synchronous tick
      jobsRef.current = { ...jobsRef.current, ...newJobs };

      // implementation_plan.md D.5 (EC-15): the backend silently reused an
      // existing job (double-click, or the identical document+target+domain
      // resubmitted within the idempotency window) instead of creating a new
      // one. Surface that as a popup rather than leaving it invisible.
      if (duplicateCount > 0) {
        setDuplicateNotice(
          duplicateCount === startData.jobs.length
            ? "This looks like a job you've already submitted. We're showing you its existing status instead of starting a new one."
            : `${duplicateCount} of your ${startData.jobs.length} requested translations matched a job you've already submitted — showing its existing status instead of starting a new one.`,
        );
      }

      ensurePolling();
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const hasActive = Object.values(jobsRef.current).some(
        (j) => j.status === 'queued' || j.status === 'processing',
      );
      if (!hasActive) {
        setStatus('failed');
      }
      setError(err instanceof Error ? err.message : 'Failed to start translation job.');
      throw err;
    }
  }, [ensurePolling]);

  /**
   * Rehydrate a previously-submitted batch (e.g. after a page refresh) from
   * a live status snapshot already fetched by the caller, then resume
   * polling any non-terminal jobs.
   */
  const resumeBatch = useCallback((
    resumedBatchId: string,
    order: string[],
    statusItems: MultiJobStatusItem[],
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
    setJobs((prev) => ({ ...prev, ...rehydratedJobs }));
    setJobOrder((prev) => {
      const set = new Set(prev);
      const filtered = order.filter((id) => !set.has(id));
      return [...prev, ...filtered];
    });
    setError(null);

    jobsRef.current = { ...jobsRef.current, ...rehydratedJobs };

    const nonTerminal = statusItems.filter(
      (item) => !['completed', 'failed', 'cancelled'].includes(item.status),
    );

    if (nonTerminal.length > 0) {
      ensurePolling();
    } else {
      setStatus(deriveOverallStatus({ ...jobsRef.current, ...rehydratedJobs }));
    }
  }, [ensurePolling, deriveOverallStatus]);

  /**
   * Full reset — clears all state and cancels polling.
   */
  const reset = useCallback(() => {
    sessionGenRef.current += 1;
    setStatus('idle');
    setBatchId(null);
    setJobs({});
    setJobOrder([]);
    setDownloadInfo({});
    setError(null);
    setDuplicateNotice(null);
    setResumeFailedNotice(null);
    downloadFetchedAtRef.current = {};
    clearPolling();
  }, [clearPolling]);

  /**
   * Retry: resume polling any non-terminal jobs.
   * Otherwise reset to idle for a fresh submit.
   */
  const retryOrReset = useCallback(() => {
    const remaining = Object.values(jobsRef.current)
      .filter((j) => j.status !== 'completed' && j.status !== 'failed' && j.status !== 'cancelled')
      .map((j) => j.job_id);

    if (remaining.length > 0) {
      setError(null);
      ensurePolling();
    } else {
      reset();
    }
  }, [ensurePolling, reset]);

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
    duplicateNotice,
    dismissDuplicateNotice,
    resumeFailedNotice,
    dismissResumeFailedNotice,
    reportResumeFailed,
    startTranslation,
    resumeBatch,
    retryOrReset,
    reset,
    getValidDownloadUrl,
    cancelJob,
  };
};
