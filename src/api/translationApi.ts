import type { TranslateResponse, JobStatusResponse } from '../types/translation';

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  'https://192.168.1.6/api/v1';

// ── Token helpers ──────────────────────────────────────────────────────────

function getStoredToken(): string | null {
  return sessionStorage.getItem('colt_auth_token');
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredToken();
  return {
    accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ── API ────────────────────────────────────────────────────────────────────

export const translationApi = {
  async startTranslation(formData: FormData): Promise<TranslateResponse> {
    const response = await fetch(`${API_BASE}/translate`, {
      method: 'POST',
      headers: authHeaders(), // Content-Type omitted so browser sets multipart boundary automatically
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || err.message || `HTTP ${response.status}`);
    }

    return response.json();
  },

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await fetch(`${API_BASE}/translate/${jobId}`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || err.message || `HTTP ${response.status}`);
    }

    return response.json();
  },
};
