import { useState, useCallback, useRef, useEffect } from 'react';
import { translationApi } from '../api/translationApi';
import type { JobStatusResponse, DownloadUrlResponse } from '../types/translation';

export type TranslationStatus = 'idle' | 'submitting' | 'polling' | 'completed' | 'failed';

// ── Retry helper ───────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry `fn` up to `maxAttempts` times with exponential back-off.
 * Each attempt calls `fn()` fresh — important for FormData factories (Bug 2).
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
  const [jobData, setJobData] = useState<JobStatusResponse | null>(null);
  const [downloadInfo, setDownloadInfo] = useState<DownloadUrlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollingIntervalRef = useRef<number | null>(null);
  /** Number of consecutive polling failures; resets to 0 on a successful poll. */
  const pollErrorCountRef = useRef<number>(0);
  /** The job ID of the most recently started job (survives polling failures). */
  const activeJobIdRef = useRef<string | null>(null);
  /**
   * Bug 1 & 4 — Session generation counter.
   * Incremented on every new polling session. In-flight callbacks from previous
   * sessions check their captured generation against this ref and bail if stale.
   * This eliminates the race where an old in-flight poll resolves AFTER a new
   * job has started and overwrites the new job's state.
   */
  const sessionGenRef = useRef<number>(0);
  /**
   * Bug 4 — Mounted flag.
   * Prevents any async callbacks from calling setState after unmount.
   */
  const isMountedRef = useRef<boolean>(true);
  /**
   * Bug 5 — When downloadInfo was last fetched (ms since epoch).
   * Used to detect when a signed URL is approaching expiry.
   */
  const downloadFetchedAtRef = useRef<number>(0);

  // Track mounted state
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
   * Fetch a fresh signed download URL and cache it with a timestamp.
   * Internal use only — called after a job completes.
   */
  const fetchDownloadUrl = useCallback(async (jobId: string) => {
    try {
      const info = await translationApi.getDownloadUrl(jobId);
      if (!isMountedRef.current) return; // Bug 4: guard
      setDownloadInfo(info);
      downloadFetchedAtRef.current = Date.now();
    } catch (err) {
      // Non-fatal: the result object may still carry a download_url inline
      console.warn('Could not fetch signed download URL:', err);
    }
  }, []);

  /**
   * Bug 5 — Returns a guaranteed-valid download URL, re-fetching from the
   * API if the cached URL is expired or expiring within 60 seconds.
   * Exported for use by the download button handler.
   */
  const getValidDownloadUrl = useCallback(async (): Promise<string | null> => {
    const jobId = activeJobIdRef.current ?? jobData?.job_id;
    if (!jobId) return null;

    // Check if cached URL is still fresh enough
    if (downloadInfo) {
      const ageMs = Date.now() - downloadFetchedAtRef.current;
      const expiresInMs = downloadInfo.expires_in * 1000;
      const isStillValid = ageMs < expiresInMs - 60_000; // 60 s buffer
      if (isStillValid) {
        return downloadInfo.download_url;
      }
    }

    // Expired or missing — fetch a fresh one
    try {
      const info = await translationApi.getDownloadUrl(jobId);
      if (isMountedRef.current) {
        setDownloadInfo(info);
        downloadFetchedAtRef.current = Date.now();
      }
      return info.download_url;
    } catch {
      // Last resort: return whatever we have (may be stale)
      return downloadInfo?.download_url ?? null;
    }
  }, [downloadInfo, jobData]);

  /**
   * Single poll tick. Accepts the polling session's generation ID so it can
   * detect if it has been superseded by a newer session (Bug 1 & 4).
   */
  const pollJobStatus = useCallback(async (jobId: string, myGen: number) => {
    // Bug 1 & 4: bail immediately if a newer session has started or unmounted
    if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

    try {
      const data = await translationApi.getJobStatus(jobId);

      // Check again after the async call in case the session advanced mid-flight
      if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

      pollErrorCountRef.current = 0;
      setJobData(data);

      if (data.status === 'completed') {
        clearPolling();
        setStatus('completed');
        await fetchDownloadUrl(jobId);
      } else if (data.status === 'failed' || data.status === 'cancelled') {
        clearPolling();
        setStatus('failed');
        setError(data.error_message || 'Translation job failed.');
      }
      // 'queued' | 'processing' → keep polling
    } catch (err: unknown) {
      if (!isMountedRef.current || myGen !== sessionGenRef.current) return;

      pollErrorCountRef.current += 1;
      console.warn(`Polling error (attempt ${pollErrorCountRef.current}):`, err);

      // Only surface an error after 3 consecutive failures — single blips are silent
      if (pollErrorCountRef.current >= 3) {
        clearPolling();
        setStatus('failed');
        setError(err instanceof Error ? err.message : 'Error checking job status.');
      }
    }
  }, [clearPolling, fetchDownloadUrl]);

  /**
   * Begin (or resume) polling for `jobId`.
   * Advances the session generation so any in-flight work from the previous
   * session becomes a no-op when it resolves (Bug 1).
   */
  const startPolling = useCallback((jobId: string) => {
    clearPolling();
    pollErrorCountRef.current = 0;
    activeJobIdRef.current = jobId;

    // Bug 1: advance generation — previous in-flight callbacks will bail
    const myGen = sessionGenRef.current + 1;
    sessionGenRef.current = myGen;

    setStatus('polling');

    pollingIntervalRef.current = window.setInterval(() => {
      pollJobStatus(jobId, myGen);
    }, 3000);

    // Kick off immediately
    pollJobStatus(jobId, myGen);
  }, [clearPolling, pollJobStatus]);

  /**
   * Bug 2 — Accepts a FACTORY function `() => FormData` rather than a FormData
   * instance. On each retry attempt the factory is called fresh, producing a new
   * FormData with an unconsumed file stream. Passing the same FormData object
   * to multiple fetch() calls exhausts the stream on the first attempt, causing
   * subsequent retries to send an empty body.
   */
  const startTranslation = useCallback(async (buildFormData: () => FormData) => {
    setStatus('submitting');
    setError(null);
    setJobData(null);
    setDownloadInfo(null);
    activeJobIdRef.current = null;
    // Bug 1: kill any previous session
    sessionGenRef.current += 1;
    clearPolling();

    try {
      const startData = await withRetry(
        () => translationApi.startTranslation(buildFormData()),
        3,
        1000,
      );

      startPolling(startData.job_id);
    } catch (err: unknown) {
      if (!isMountedRef.current) return; // Bug 4: guard
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Failed to start translation job.');
    }
  }, [startPolling, clearPolling]);

  /**
   * Smart "Try Again":
   * - Job ID known → resume polling (the backend job is still running)
   * - No job ID → submission failed; go back to idle for a fresh submit
   */
  const retryOrReset = useCallback(() => {
    const jobId = activeJobIdRef.current ?? jobData?.job_id;
    if (jobId) {
      setError(null);
      setDownloadInfo(null);
      startPolling(jobId);
    } else {
      sessionGenRef.current += 1; // kill any in-flight work
      setStatus('idle');
      setJobData(null);
      setDownloadInfo(null);
      setError(null);
      clearPolling();
    }
  }, [jobData, startPolling, clearPolling]);

  /** Full reset — clears all state and cancels any in-flight work. */
  const reset = useCallback(() => {
    // Bug 1: advance generation to neutralise any in-flight callbacks
    sessionGenRef.current += 1;
    setStatus('idle');
    setJobData(null);
    setDownloadInfo(null);
    setError(null);
    activeJobIdRef.current = null;
    clearPolling();
  }, [clearPolling]);

  // Clean up on unmount
  useEffect(() => {
    return () => clearPolling();
  }, [clearPolling]);

  return {
    status,
    jobData,
    downloadInfo,
    error,
    startTranslation,
    retryOrReset,
    reset,
    getValidDownloadUrl,
  };
};
