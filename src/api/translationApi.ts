import type {
  MultiTranslateResponse,
  MultiJobStatusRequest,
  MultiJobStatusResponse,
  JobStatusResponse,
  DownloadUrlResponse,
  ReviewRequest,
  ReviewResponse,
} from '../types/translation';
import {
  ensureFreshGoogleIdToken,
  forceRefreshGoogleIdToken,
} from './cloudRunAuth';
import { TRANSLATION_API_BASE, TRANSLATION_API_ORIGIN } from './translationConfig';

/** Same-origin `/api/translation/v1` — Vite (dev) or hub ILB (prod) → Translation `/api/v1`. */
const API_BASE = TRANSLATION_API_BASE;

export { TRANSLATION_API_ORIGIN };

// ── Token helpers ──────────────────────────────────────────────────────────

function getStoredToken(): string | null {
  return localStorage.getItem('colt_auth_token');
}

/**
 * Authorization: Bearer <Google OIDC> — Cloud Run IAM (nginx → X-Serverless-Authorization).
 * x-app-auth: Bearer <app JWT> — Translation FastAPI (security.py strips "Bearer " prefix).
 */
async function authHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const token = getStoredToken();
  const googleIdToken = await ensureFreshGoogleIdToken();
  return {
    accept: 'application/json',
    ...(googleIdToken ? { Authorization: `Bearer ${googleIdToken}` } : {}),
    ...(token ? { 'x-app-auth': `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function fetchWithAuth(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response = await fetch(url, {
    ...init,
    headers: { ...(await authHeaders()), ...init.headers },
  });

  if (response.status === 401 || response.status === 403) {
    await forceRefreshGoogleIdToken();
    response = await fetch(url, {
      ...init,
      headers: { ...(await authHeaders()), ...init.headers },
    });
  }

  return response;
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
