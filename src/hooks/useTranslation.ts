import { useState, useCallback, useRef, useEffect } from 'react';
import { translationApi } from '../api/translationApi';
import type { JobStatusResponse, DownloadUrlResponse } from '../types/translation';

export type TranslationStatus = 'idle' | 'submitting' | 'polling' | 'completed' | 'failed';

export const useTranslation = () => {
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [jobData, setJobData] = useState<JobStatusResponse | null>(null);
  const [downloadInfo, setDownloadInfo] = useState<DownloadUrlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollingIntervalRef = useRef<number | null>(null);

  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  /**
   * After the job completes, fetch a fresh signed download URL via
   * GET /api/v1/jobs/{job_id}/download so the link never expires mid-session.
   * Falls back gracefully if the endpoint is unavailable.
   */
  const fetchDownloadUrl = useCallback(async (jobId: string) => {
    try {
      const info = await translationApi.getDownloadUrl(jobId);
      setDownloadInfo(info);
    } catch (err) {
      // Non-fatal: the result object may still carry a download_url inline
      console.warn('Could not fetch signed download URL:', err);
    }
  }, []);

  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const data = await translationApi.getJobStatus(jobId);
      setJobData(data);

      // API returns lowercase status values: "queued" | "processing" | "completed" | "failed"
      if (data.status === 'completed') {
        clearPolling();
        setStatus('completed');
        // Fetch a dedicated signed URL now that the job is done
        await fetchDownloadUrl(jobId);
      } else if (data.status === 'failed' || data.status === 'cancelled') {
        clearPolling();
        setStatus('failed');
        setError(data.error_message || 'Translation job failed.');
      }
      // 'queued' and 'processing' → keep polling
    } catch (err: unknown) {
      console.error('Polling error:', err);
      clearPolling();
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Error checking job status.');
    }
  }, [clearPolling, fetchDownloadUrl]);

  const startTranslation = useCallback(async (formData: FormData) => {
    setStatus('submitting');
    setError(null);
    setJobData(null);
    setDownloadInfo(null);
    clearPolling();

    try {
      const startData = await translationApi.startTranslation(formData);

      setStatus('polling');

      // Poll every 3 seconds for job completion
      pollingIntervalRef.current = window.setInterval(() => {
        pollJobStatus(startData.job_id);
      }, 3000);

      // Kick off immediately so we don't wait 3 s for first check
      pollJobStatus(startData.job_id);
    } catch (err: unknown) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Failed to start translation job.');
    }
  }, [pollJobStatus, clearPolling]);

  const reset = useCallback(() => {
    setStatus('idle');
    setJobData(null);
    setDownloadInfo(null);
    setError(null);
    clearPolling();
  }, [clearPolling]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => clearPolling();
  }, [clearPolling]);

  return {
    status,
    jobData,
    downloadInfo,
    error,
    startTranslation,
    reset,
  };
};
