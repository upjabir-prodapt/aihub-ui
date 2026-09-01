import type {
  MultiTranslateResponse,
  MultiJobStatusRequest,
  MultiJobStatusResponse,
  JobStatusResponse,
  DownloadUrlResponse,
  ReviewRequest,
  ReviewResponse,
  LegacyJobStatusResponse,
} from './types';
import { apiDownload, apiFetch, apiJson, apiPostJson } from '../../shared/api/client';

/**
 * Same-origin `/api/translation/v1/*`, proxied by the BFF to Apigee.
 *
 * There is no auth code left in here. The session cookie is attached by the
 * browser, the CSRF token by `shared/api/client`, and the Entra bearer token
 * plus `x-colt-user-*` headers are injected server-side by the BFF. The old
 * Google metadata-server ID token fetch and its 401-retry loop are gone with
 * the architecture that needed them.
 */
const API_BASE = '/api/translation/v1';

/** `POST /api/translation/uploads` — signed GCS PUT URL (decision D10). */
export interface SignedUpload {
  upload_url: string;
  gs_uri: string;
  object_name: string;
  expires_in: number;
  required_headers: Record<string, string>;
}

export const translationApi = {
  async startTranslation(formData: FormData): Promise<MultiTranslateResponse> {
    // No Content-Type header: the browser must set the multipart boundary.
    return await apiJson<MultiTranslateResponse>(`${API_BASE}/translate`, {
      method: 'POST',
      body: formData,
      errorMessage: 'Failed to submit translation job',
    });
  },

  async getMultipleJobStatuses(jobIds: string[]): Promise<MultiJobStatusResponse> {
    const requestBody: MultiJobStatusRequest = { job_ids: jobIds };
    return await apiPostJson<MultiJobStatusResponse>(`${API_BASE}/jobs/status`, requestBody, {
      errorMessage: 'Failed to fetch job statuses',
    });
  },

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    return await apiJson<JobStatusResponse>(`${API_BASE}/translate/${jobId}`, {
      errorMessage: 'Failed to fetch job status',
    });
  },

  async getDownloadUrl(jobId: string): Promise<DownloadUrlResponse> {
    return await apiJson<DownloadUrlResponse>(`${API_BASE}/jobs/${jobId}/download`, {
      errorMessage: 'Failed to get download URL',
    });
  },

  /**
   * `GET /jobs` — this user's job history for the Job Tracker. Accepts either a
   * bare array or a `{ jobs: [...] }` envelope; the live service's exact shape
   * was never confirmed, and the mock upstream emits the envelope.
   */
  async listJobs(): Promise<LegacyJobStatusResponse[]> {
    const data = await apiJson<{ jobs?: LegacyJobStatusResponse[] } | LegacyJobStatusResponse[]>(
      `${API_BASE}/jobs`,
      { errorMessage: 'Failed to fetch job history' },
    );
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.jobs)) return data.jobs;
    return [];
  },

  async cancelJob(jobId: string, reason?: string): Promise<{ message: string }> {
    return await apiPostJson<{ message: string }>(
      `${API_BASE}/jobs/${jobId}`,
      { reason: reason ?? 'Cancelled by user' },
      { method: 'DELETE', errorMessage: 'Failed to cancel job' },
    );
  },

  async submitReview(jobId: string, review: ReviewRequest): Promise<ReviewResponse> {
    return await apiPostJson<ReviewResponse>(`${API_BASE}/reviews/${jobId}`, review, {
      errorMessage: 'Failed to submit review',
    });
  },

  /**
   * Ask the BFF for a signed GCS PUT URL so the document never crosses Apigee.
   * Returns `null` when `TRANSLATION_UPLOAD_MODE=multipart`, in which case the
   * caller falls back to posting the file through the proxy.
   */
  async requestSignedUpload(file: File): Promise<SignedUpload | null> {
    try {
      return await apiPostJson<SignedUpload>('/api/translation/uploads', {
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
      });
    } catch (err) {
      // 409 means the deployment is in multipart mode; anything else is real.
      if (err && typeof err === 'object' && (err as { status?: number }).status === 409) {
        return null;
      }
      throw err;
    }
  },

  /** PUT the file straight to GCS. Must send exactly the signed headers. */
  async uploadToSignedUrl(signed: SignedUpload, file: File): Promise<void> {
    const response = await fetch(signed.upload_url, {
      method: 'PUT',
      headers: signed.required_headers,
      body: file,
      // Cross-origin to storage.googleapis.com; never send our cookie.
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error(`Upload to storage failed (HTTP ${response.status})`);
    }
  },

  async downloadTranslatedFile(jobId: string): Promise<void> {
    await apiDownload(`${API_BASE}/jobs/${jobId}/file`, `translated-${jobId}.txt`);
  },

  /** Escape hatch for callers that need the raw `Response`. */
  raw: (path: string, init?: Parameters<typeof apiFetch>[1]) => apiFetch(`${API_BASE}${path}`, init),
};
