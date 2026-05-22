import type { TranslateResponse, JobStatusResponse } from '../types/translation';
import {
  ensureFreshGoogleIdToken,
  forceRefreshGoogleIdToken,
} from './cloudRunAuth';
import { TRANSLATION_API_ORIGIN } from './translationConfig';

/** Same-origin `/api/v1` — Vite (dev) or UI nginx (prod) proxies to Translation DNS. */
const API_BASE = '/api/v1';

export { TRANSLATION_API_ORIGIN };

// ── Token helpers ──────────────────────────────────────────────────────────

function getStoredToken(): string | null {
  return sessionStorage.getItem('colt_auth_token');
}

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

// ── API ────────────────────────────────────────────────────────────────────

export const translationApi = {
  async startTranslation(formData: FormData): Promise<TranslateResponse> {
    const response = await fetchWithAuth(`${API_BASE}/translate`, {
      method: 'POST',
      // Content-Type omitted so browser sets multipart boundary automatically
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || err.message || `HTTP ${response.status}`);
    }

    return response.json();
  },

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await fetchWithAuth(`${API_BASE}/translate/${jobId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || err.message || `HTTP ${response.status}`);
    }

    return response.json();
  },
};
