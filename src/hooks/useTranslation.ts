import { useState, useCallback, useRef, useEffect } from 'react';
import { translationApi } from '../api/translationApi';
import { type JobStatusResponse } from '../types/translation';

export type TranslationStatus = 'idle' | 'submitting' | 'polling' | 'completed' | 'failed';

export const useTranslation = () => {
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [jobData, setJobData] = useState<JobStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollingIntervalRef = useRef<number | null>(null);

  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const data = await translationApi.getJobStatus(jobId);
      setJobData(data);

      if (data.status === 'COMPLETED') {
        setStatus('completed');
        clearPolling();
      } else if (data.status === 'FAILED') {
        setStatus('failed');
        setError(data.error_message || 'Translation job failed.');
        clearPolling();
      }
      // If PENDING or PROCESSING, keep polling
    } catch (err: any) {
      console.error('Polling error:', err);
      // We might want to retry a few times before giving up
      setStatus('failed');
      setError(err.message || 'Error checking job status.');
      clearPolling();
    }
  }, [clearPolling]);

  const startTranslation = useCallback(async (formData: FormData) => {
    setStatus('submitting');
    setError(null);
    setJobData(null);
    clearPolling();

    try {
      const startData = await translationApi.startTranslation(formData);

      // Initial status update
      setStatus('polling');

      // Start polling
      pollingIntervalRef.current = window.setInterval(() => {
        pollJobStatus(startData.job_id);
      }, 2000); // Poll every 2 seconds

    } catch (err: any) {
      setStatus('failed');
      setError(err.message || 'Failed to start translation job.');
    }
  }, [pollJobStatus, clearPolling]);

  const reset = useCallback(() => {
    setStatus('idle');
    setJobData(null);
    setError(null);
    clearPolling();
  }, [clearPolling]);

  // Clean up on unmount
  useEffect(() => {
    return () => clearPolling();
  }, [clearPolling]);

  return {
    status,
    jobData,
    error,
    startTranslation,
    reset,
  };
};
