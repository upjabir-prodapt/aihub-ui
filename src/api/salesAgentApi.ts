// ── Sales Research API ─────────────────────────────────────────────────────
// Routed through nginx proxy: /api/sales/v1/ → https://salesagent.aicoesandox-int.colt.net/api/v1/

export const SALES_API_BASE = '/api/sales/v1';

const CLOUD_RUN_AUDIENCE = 'https://salesagent-api-service-297743845367.europe-west1.run.app';

// ── Session storage keys (isolated from the translation service) ────────────

const SALES_TOKEN_KEY = 'sales_auth_token';
const SALES_GOOGLE_TOKEN_KEY = 'sales_google_id_token';
const SALES_USER_KEY = 'sales_auth_user';
const SALES_EXPIRY_KEY = 'sales_auth_expiry';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SalesAuthUser {
  email: string;
  business_unit: string;
  organization: string;
}

export interface SalesTokenResponse {
  access_token: string;
  token_type: string;
}

export interface InitiateResearchResponse {
  job_id: string;
  status: string;
  [key: string]: unknown;
}

export interface ResearchStatusResponse {
  job_id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  [key: string]: unknown;
}

export interface ResearchResultResponse {
  job_id: string;
  status: string;
  report_markdown?: string;
  [key: string]: unknown;
}

// ── Session helpers ────────────────────────────────────────────────────────

export function saveSalesSession(token: string, googleIdToken: string, user: SalesAuthUser, expiresInSeconds = 1800) {
  const expiry = Date.now() + expiresInSeconds * 1000;
  sessionStorage.setItem(SALES_TOKEN_KEY, token);
  sessionStorage.setItem(SALES_GOOGLE_TOKEN_KEY, googleIdToken);
  sessionStorage.setItem(SALES_USER_KEY, JSON.stringify(user));
  sessionStorage.setItem(SALES_EXPIRY_KEY, String(expiry));
}

export function loadSalesSession(): { token: string; googleIdToken: string; user: SalesAuthUser } | null {
  const token = sessionStorage.getItem(SALES_TOKEN_KEY);
  const googleIdToken = sessionStorage.getItem(SALES_GOOGLE_TOKEN_KEY) ?? '';
  const userRaw = sessionStorage.getItem(SALES_USER_KEY);
  const expiryRaw = sessionStorage.getItem(SALES_EXPIRY_KEY);

  if (!token || !userRaw || !expiryRaw) return null;
  if (Date.now() > parseInt(expiryRaw, 10)) {
    clearSalesSession();
    return null;
  }

  try {
    const user: SalesAuthUser = JSON.parse(userRaw);
    return { token, googleIdToken, user };
  } catch {
    return null;
  }
}

export function clearSalesSession() {
  sessionStorage.removeItem(SALES_TOKEN_KEY);
  sessionStorage.removeItem(SALES_GOOGLE_TOKEN_KEY);
  sessionStorage.removeItem(SALES_USER_KEY);
  sessionStorage.removeItem(SALES_EXPIRY_KEY);
}

// ── Auth headers helper ────────────────────────────────────────────────────

function getStoredSalesGoogleIdToken(): string | null {
  return sessionStorage.getItem('sales_google_id_token');
}

/**
 * Builds auth headers for all authenticated Sales Agent requests.
 * The app-level JWT goes in Authorization, and the Google ID token
 * (used for Cloud Run IAM) is sent as x-app-auth, which Nginx forwards
 * as X-Serverless-Authorization to the backend.
 */
function salesAuthHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  const googleIdToken = getStoredSalesGoogleIdToken();
  return {
    accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(googleIdToken ? { 'x-app-auth': googleIdToken } : {}),
    ...extra,
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

/** POST /api/v1/auth/token — only @colt.net emails accepted by the server */
export async function salesAuthenticate(
  email: string,
  business_unit: string,
  organization: string,
): Promise<SalesTokenResponse & { googleIdToken: string }> {
  // Step 1: Fetch Google ID token via Nginx metadata proxy
  let googleIdToken = '';
  try {
    const metaRes = await fetch(`/api/metadata/id-token?audience=${encodeURIComponent(CLOUD_RUN_AUDIENCE)}`);
    if (metaRes.ok) {
      googleIdToken = await metaRes.text();
    } else {
      console.warn('Metadata endpoint returned status:', metaRes.status);
      googleIdToken = 'mock_google_id_token_for_local_dev';
    }
  } catch (err) {
    console.warn('Failed to reach metadata endpoint (likely local dev):', err);
    googleIdToken = 'mock_google_id_token_for_local_dev';
  }

  // Step 2: Get Sales JWT
  const res = await fetch(`${SALES_API_BASE}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      Authorization: `Bearer ${googleIdToken}`,
    },
    body: JSON.stringify({ email, business_unit, organization }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Authentication failed.' }));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return { ...data, googleIdToken };
}

/** POST /api/v1/research/initiate */
export async function initiateResearch(
  token: string,
  account_id: string,
  company_name: string,
): Promise<InitiateResearchResponse> {
  const res = await fetch(`${SALES_API_BASE}/research/initiate`, {
    method: 'POST',
    headers: salesAuthHeaders(token),
    body: JSON.stringify({ account_id, company_name }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to initiate research.' }));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }

  return res.json();
}

/** GET /api/v1/research/status/{job_id} */
export async function getResearchStatus(
  token: string,
  job_id: string,
): Promise<ResearchStatusResponse> {
  const res = await fetch(`${SALES_API_BASE}/research/status/${job_id}`, {
    method: 'GET',
    headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to fetch status.' }));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }

  return res.json();
}

/** GET /api/v1/research/result/{job_id} */
export async function getResearchResult(
  token: string,
  job_id: string,
): Promise<ResearchResultResponse> {
  const res = await fetch(`${SALES_API_BASE}/research/result/${job_id}`, {
    method: 'GET',
    headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to fetch result.' }));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * GET /api/v1/research/download/{job_id}
 * Triggers a direct binary file download in the browser.
 */
export async function downloadResearchFile(token: string, job_id: string): Promise<void> {
  const res = await fetch(`${SALES_API_BASE}/research/download/${job_id}`, {
    method: 'GET',
    headers: { accept: '*/*', Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Download failed.' }));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }

  // Determine filename from Content-Disposition or fall back to job_id
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
  const filename = match ? match[1].replace(/['"]/g, '') : `research-${job_id}.pdf`;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
