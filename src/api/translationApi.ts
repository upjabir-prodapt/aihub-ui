import type {
  MultiTranslateResponse,
  MultiJobStatusRequest,
  MultiJobStatusResponse,
  JobStatusResponse,
  DownloadUrlResponse,
  ReviewRequest,
  ReviewResponse,
  LegacyJobStatusResponse,
} from '../types/translation';
import {
  ensureFreshGoogleIdToken,
  forceRefreshGoogleIdToken,
} from './cloudRunAuth';
import { TRANSLATION_API_BASE, TRANSLATION_API_ORIGIN } from './translationConfig';

/** Same-origin `/api/translation/v1` — Vite (dev) or hub ILB (prod) → Translation `/api/v1`. */
const API_BASE = TRANSLATION_API_BASE;

export { TRANSLATION_API_ORIGIN };

// ── Auth headers ─────────────────────────────────────────────────────────
//
// The app-session JWT is no longer read from localStorage and attached as
// `x-app-auth` here — it now travels automatically via the httpOnly
// `colt_session` cookie set by POST /auth/token, as long as the fetch call
// includes `credentials: 'include'` (see fetchWithAuth below). This closes
// the XSS-exfiltration risk of a JS-readable bearer token in localStorage.

/**
 * Authorization: Bearer <Google OIDC> — Cloud Run IAM (nginx → X-Serverless-Authorization).
 */
async function authHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const googleIdToken = await ensureFreshGoogleIdToken();
  return {
    accept: 'application/json',
    ...(googleIdToken ? { Authorization: `Bearer ${googleIdToken}` } : {}),
    ...extra,
  };
}

async function fetchWithAuth(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { ...(await authHeaders()), ...init.headers },
  });

  if (response.status === 401 || response.status === 403) {
    await forceRefreshGoogleIdToken();
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: { ...(await authHeaders()), ...init.headers },
    });
  }

  return response;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      detail?: string;
      message?: string;
    };
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

    return (await response.json()) as MultiTranslateResponse;
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

    return (await response.json()) as MultiJobStatusResponse;
  },

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await fetchWithAuth(`${API_BASE}/translate/${jobId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to fetch job status'));
    }

    return (await response.json()) as JobStatusResponse;
  },

  async getDownloadUrl(jobId: string): Promise<DownloadUrlResponse> {
    const response = await fetchWithAuth(`${API_BASE}/jobs/${jobId}/download`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to get download URL'));
    }

    return (await response.json()) as DownloadUrlResponse;
  },

  /**
   * GET /api/v1/jobs — this user's job history (queued/processing/completed/
   * failed), for the Job Tracker page. Accepts either a bare array or a
   * `{ jobs: [...] }` envelope from the backend, since the exact response
   * shape wasn't confirmed against the live service at the time this was
   * written — adjust the parsing below if the real shape differs.
   */
  async listJobs(): Promise<LegacyJobStatusResponse[]> {
    const response = await fetchWithAuth(`${API_BASE}/jobs`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, 'Failed to fetch job history'));
    }

    const data = (await response.json()) as { jobs?: LegacyJobStatusResponse[] } | LegacyJobStatusResponse[];
    if (Array.isArray(data)) return data as LegacyJobStatusResponse[];
    if (Array.isArray(data?.jobs)) return data.jobs as LegacyJobStatusResponse[];
    return [];
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

    return (await response.json()) as { message: string };
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

    return (await response.json()) as ReviewResponse;
  },
};
