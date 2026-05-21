import { useState, useCallback, useRef, useEffect } from 'react';
import { translationApi } from '../api/translationApi';
import type { JobStatusResponse, JobDetailResponse } from '../types/translation';

export type TranslationStatus = 'idle' | 'submitting' | 'polling' | 'completed' | 'failed' | 'cancelled';

const POLL_FAST_MS = 5_000;   // first 2 minutes
const POLL_SLOW_MS = 15_000;  // after 2 minutes
const FAST_POLL_CUTOFF_MS = 2 * 60 * 1000;

export const useTranslation = () => {
  const [status, setStatus]   = useState<TranslationStatus>('idle');
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetailResponse | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const pollingRef     = useRef<number | null>(null);
  const pollStartTime  = useRef<number>(0);
  const currentJobId   = useRef<string | null>(null);

  // ── Polling cleanup ──────────────────────────────────────────────────────
  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // ── Single poll tick ─────────────────────────────────────────────────────
  const pollOnce = useCallback(async (jobId: string) => {
    try {
      const data = await translationApi.pollJobStatus(jobId);
      setJobStatus(data);

      if (data.status === 'completed') {
        clearPolling();
        setStatus('polling'); // keep spinner while fetching full result
        // Fetch full result with translated document
        try {
          const detail = await translationApi.getJobDetail(jobId);
          setJobDetail(detail);
          setStatus('completed');
        } catch (detailErr: unknown) {
          // Still mark completed even if detail fetch fails
          setStatus('completed');
          console.error('Failed to fetch job detail:', detailErr);
        }
      } else if (data.status === 'failed') {
        clearPolling();
        setStatus('failed');
        setError(data.error_message || 'Translation job failed.');
      } else if (data.status === 'cancelled') {
        clearPolling();
        setStatus('cancelled');
      }
      // queued / processing → keep polling; adapt interval after 2 min
    } catch (err: unknown) {
      console.error('Polling error:', err);
      clearPolling();
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Error checking job status.');
    }
  }, [clearPolling]);

  // ── Start adaptive polling ────────────────────────────────────────────────
  const startPolling = useCallback((jobId: string) => {
    clearPolling();
    pollStartTime.current = Date.now();
    currentJobId.current  = jobId;

    // Immediate first poll
    void pollOnce(jobId);

    pollingRef.current = window.setInterval(() => {
      const elapsed = Date.now() - pollStartTime.current;
      const interval = elapsed < FAST_POLL_CUTOFF_MS ? POLL_FAST_MS : POLL_SLOW_MS;

      // Re-schedule at slower rate once threshold crossed (restart interval)
      if (elapsed > FAST_POLL_CUTOFF_MS && pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = window.setInterval(() => {
          if (currentJobId.current) void pollOnce(currentJobId.current);
        }, POLL_SLOW_MS);
      }

      void pollOnce(jobId);
      // suppress unused warning — interval used above for re-scheduling
      void interval;
    }, POLL_FAST_MS);
  }, [clearPolling, pollOnce]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const startTranslation = useCallback(async (formData: FormData) => {
    setStatus('submitting');
    setError(null);
    setJobStatus(null);
    setJobDetail(null);
    clearPolling();

    try {
      const submitted = await translationApi.startTranslation(formData);
      setStatus('polling');
      startPolling(submitted.job_id);
    } catch (err: unknown) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Failed to start translation job.');
    }
  }, [startPolling, clearPolling]);

  // ── Cancel ───────────────────────────────────────────────────────────────
  const cancelJob = useCallback(async (reason?: string) => {
    const jobId = currentJobId.current;
    if (!jobId) return;
    try {
      clearPolling();
      await translationApi.cancelJob(jobId, reason);
      setStatus('cancelled');
    } catch (err: unknown) {
      console.error('Cancel failed:', err);
    }
  }, [clearPolling]);

  // ── Download ─────────────────────────────────────────────────────────────
  const getDownloadUrl = useCallback(async () => {
    const jobId = currentJobId.current;
    if (!jobId) return null;
    const resp = await translationApi.getDownloadUrl(jobId);
    return resp;
  }, []);

  // ── Reset ────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStatus('idle');
    setJobStatus(null);
    setJobDetail(null);
    setError(null);
    clearPolling();
    currentJobId.current = null;
  }, [clearPolling]);

  // Clean up on unmount
  useEffect(() => () => clearPolling(), [clearPolling]);

  return {
    status,
    /** Lightweight poll data (updated every poll tick) */
    jobStatus,
    /** Full result with translated document — available after completion */
    jobDetail,
    error,
    currentJobId: currentJobId.current,
    startTranslation,
    cancelJob,
    getDownloadUrl,
    reset,
  };
};
