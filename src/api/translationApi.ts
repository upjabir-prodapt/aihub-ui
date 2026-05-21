import type {
  TranslateResponse,
  JobStatusResponse,
  JobDetailResponse,
  JobsListResponse,
  DownloadUrlResponse,
  JobStatus,
} from '../types/translation';

const API_BASE = '/api/v1';

// ── Token helpers ──────────────────────────────────────────────────────────

function getStoredToken(): string | null {
  return sessionStorage.getItem('colt_auth_token');
}

function getStoredGoogleIdToken(): string | null {
  return sessionStorage.getItem('colt_google_id_token');
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredToken();
  const googleIdToken = getStoredGoogleIdToken();
  return {
    accept: 'application/json',
    ...(googleIdToken ? { 'X-Serverless-Authorization': `Bearer ${googleIdToken}` } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(token ? { 'x-app-auth': `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ── Error helper ───────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      // Support both {detail: ...} (FastAPI default) and {error: {message: ...}} envelope
      message =
        body?.error?.message ||
        body?.detail ||
        body?.message ||
        message;
    } catch {
      // ignore parse error
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ── API ────────────────────────────────────────────────────────────────────

export const translationApi = {
  /**
   * POST /api/v1/translate
   * Submit a document for async translation.
   */
  async startTranslation(formData: FormData): Promise<TranslateResponse> {
    const res = await fetch(`${API_BASE}/translate`, {
      method: 'POST',
      // Content-Type omitted — browser sets multipart/form-data boundary automatically
      headers: authHeaders(),
      body: formData,
    });
    return handleResponse<TranslateResponse>(res);
  },

  /**
   * GET /api/v1/jobs/{job_id}
   * Lightweight status poll — used during polling loop.
   */
  async pollJobStatus(jobId: string): Promise<JobStatusResponse> {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    return handleResponse<JobStatusResponse>(res);
  },

  /**
   * GET /api/v1/translate/{job_id}
   * Full result including translated document + metadata.
   * Called once after job reaches "completed".
   */
  async getJobDetail(jobId: string): Promise<JobDetailResponse> {
    const res = await fetch(`${API_BASE}/translate/${jobId}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    return handleResponse<JobDetailResponse>(res);
  },

  /**
   * GET /api/v1/jobs/{job_id}/download
   * Retrieve a signed GCS download URL for a completed job.
   */
  async getDownloadUrl(jobId: string): Promise<DownloadUrlResponse> {
    const res = await fetch(`${API_BASE}/jobs/${jobId}/download`, {
      method: 'GET',
      headers: authHeaders(),
    });
    return handleResponse<DownloadUrlResponse>(res);
  },

  /**
   * GET /api/v1/jobs
   * List jobs with optional status filter and pagination.
   */
  async listJobs(params?: {
    status?: JobStatus;
    limit?: number;
    offset?: number;
  }): Promise<JobsListResponse> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));

    const url = `${API_BASE}/jobs${query.toString() ? `?${query}` : ''}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(),
    });
    return handleResponse<JobsListResponse>(res);
  },

  /**
   * DELETE /api/v1/jobs/{job_id}
   * Cancel a queued or processing job.
   */
  async cancelJob(jobId: string, reason?: string): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reason: reason ?? null }),
    });
    return handleResponse<{ message: string }>(res);
  },
};
