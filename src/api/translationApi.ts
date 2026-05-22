import type {
  TranslateResponse,
  JobStatusResponse,
  DownloadUrlResponse,
} from '../types/translation';

const API_BASE = '/api/v1';

// ── Token helpers ──────────────────────────────────────────────────────────

function getStoredToken(): string | null {
  return sessionStorage.getItem('colt_auth_token');
}

function getStoredGoogleIdToken(): string | null {
  return sessionStorage.getItem('colt_google_id_token');
}

/**
 * Builds the Authorization header set for all authenticated requests.
 * The app-level JWT is sent as `Authorization: Bearer <token>`.
 * The Google ID token (used for Cloud Run IAM) is carried in `x-app-auth`.
 */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredToken();
  const googleIdToken = getStoredGoogleIdToken();
  return {
    accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(googleIdToken ? { 'x-google-id-token': googleIdToken } : {}),
    ...extra,
  };
}

/**
 * Parses an API error response into a human-readable string.
 * Handles both the standard `{ error: { message } }` shape and legacy `{ detail }` shape.
 */
async function parseApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    // Standard error shape: { error: { message, code, details } }
    if (body?.error?.message) return body.error.message;
    // Legacy / FastAPI shape
    if (body?.detail) return body.detail;
    if (body?.message) return body.message;
  } catch {
    // ignore JSON parse failure
  }
  return `${fallback} (HTTP ${response.status})`;
}

// ── API ────────────────────────────────────────────────────────────────────

export const translationApi = {
  /**
   * POST /api/v1/translate
   * Submits a document for asynchronous translation.
   * FormData must include `file`, `target_language`, `domain`, and optionally
   * `source_language`, `enable_dlp`, `enable_chunking`, `priority`.
   */
  async startTranslation(formData: FormData): Promise<TranslateResponse> {
    const response = await fetch(`${API_BASE}/translate`, {
      method: 'POST',
      // NOTE: Do NOT set Content-Type — the browser adds the multipart boundary automatically.
      headers: authHeaders(),
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to submit translation job'));
    }

    return response.json();
  },

  /**
   * GET /api/v1/translate/{job_id}
   * Retrieves full status, metadata, quality score, and results for a job.
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await fetch(`${API_BASE}/translate/${jobId}`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to fetch job status'));
    }

    return response.json();
  },

  /**
   * GET /api/v1/jobs/{job_id}/download
   * Generates a temporary signed GCS URL to download the translated document.
   */
  async getDownloadUrl(jobId: string): Promise<DownloadUrlResponse> {
    const response = await fetch(`${API_BASE}/jobs/${jobId}/download`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to get download URL'));
    }

    return response.json();
  },

  /**
   * DELETE /api/v1/jobs/{job_id}
   * Cancels a running or queued translation job.
   */
  async cancelJob(jobId: string, reason?: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reason: reason ?? 'Cancelled by user' }),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to cancel job'));
    }

    return response.json();
  },
};
