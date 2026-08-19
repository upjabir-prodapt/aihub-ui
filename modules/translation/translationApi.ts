import type {
  MultiTranslateResponse,
  MultiJobStatusRequest,
  MultiJobStatusResponse,
  JobStatusResponse,
  DownloadUrlResponse,
  ReviewRequest,
  ReviewResponse,
} from '@/modules/translation/translation';
import { TRANSLATION_API_BASE, TRANSLATION_API_ORIGIN } from '@/modules/translation/translationConfig';

/** Same-origin `/api/translation/v1` — proxied server-side by this Next.js app to Translation. */
const API_BASE = TRANSLATION_API_BASE;

export { TRANSLATION_API_ORIGIN };

// ── Token helpers ──────────────────────────────────────────────────────────

function getStoredToken(): string | null {
  return localStorage.getItem('colt_auth_token');
}

/**
 * `credentials: 'include'` carries the browser's IAP session cookie for the
 * `aihub` resource. This Next.js server (app/api/translation/v1/[...path])
 * verifies it and proxies to Translation using its own service-account IAP
 * identity — there is no separate Google/Cloud Run identity token for the
 * browser to manage anymore. `x-app-auth` is the per-service app JWT from
 * `/auth/token`.
 */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredToken();
  return {
    accept: 'application/json',
    ...(token ? { 'x-app-auth': `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: { ...authHeaders(), ...init.headers },
  });
}


async function parseApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (body?.error?.message) return body.error.message;
    if (body?.detail) return body.detail;
    if (body?.message) return body.message;
  } catch {
    // ignore JSON parse failure
  }
  return `${fallback} (HTTP ${response.status})`;
}

// ── API ────────────────────────────────────────────────────────────────────

export const translationApi = {
  async startTranslation(formData: FormData): Promise<MultiTranslateResponse> {
    const response = await fetchWithAuth(`${API_BASE}/translate`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to submit translation job'));
    }

    return response.json();
  },

  async getMultipleJobStatuses(jobIds: string[]): Promise<MultiJobStatusResponse> {
    const requestBody: MultiJobStatusRequest = { job_ids: jobIds };
    const response = await fetchWithAuth(`${API_BASE}/jobs/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to fetch job statuses'));
    }

    return response.json();
  },

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await fetchWithAuth(`${API_BASE}/translate/${jobId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to fetch job status'));
    }

    return response.json();
  },

  async getDownloadUrl(jobId: string): Promise<DownloadUrlResponse> {
    const response = await fetchWithAuth(`${API_BASE}/jobs/${jobId}/download`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to get download URL'));
    }

    return response.json();
  },

  async cancelJob(jobId: string, reason?: string): Promise<{ message: string }> {
    const response = await fetchWithAuth(`${API_BASE}/jobs/${jobId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason ?? 'Cancelled by user' }),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to cancel job'));
    }

    return response.json();
  },

  async submitReview(jobId: string, review: ReviewRequest): Promise<ReviewResponse> {
    const response = await fetchWithAuth(`${API_BASE}/reviews/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to submit review'));
    }

    return response.json();
  },
};
