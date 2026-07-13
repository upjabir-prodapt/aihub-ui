import {
  ensureFreshSalesGoogleIdToken,
  fetchSalesGoogleIdToken,
  forceRefreshSalesGoogleIdToken,
  persistSalesGoogleIdToken,
} from './salesCloudRunAuth';
import { SALES_API_BASE } from './salesConfig';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SalesAuthUser {
  email: string;
  business_unit: string;
  organization: string;
}

export interface SalesTokenResponse {
  access_token: string;
  token_type: string;
  email: string;
}

export interface InitiateResearchResponse {
  job_id: string;
  status: string;
  [key: string]: unknown;
}

export interface ResearchStatusResponse {
  job_id: string;
  status: 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  [key: string]: unknown;
}

/** Cost & model metadata for a completed research run (backend `model_card`). */
export interface ResearchModelCard {
  model_version?: string | null;
  tokens_used?: number | null;
  latency_seconds?: number | null;
  cost_usd?: number | null;
}

export interface ResearchResultResponse {
  job_id: string;
  /** Backend uses `request_id`; kept alongside job_id for compatibility. */
  request_id?: string;
  status: string;
  /** Canonical field returned by the backend (FastAPI `ResearchResultResponse`). */
  report_content?: string;
  /** Legacy alias — no longer emitted by the backend; kept for compatibility. */
  report_markdown?: string;
  model_card?: ResearchModelCard | null;
  [key: string]: unknown;
}

// ── Session storage (isolated from Translation) ────────────────────────────

const SALES_TOKEN_KEY = 'sales_auth_token';
const SALES_USER_KEY = 'sales_auth_user';
const SALES_EXPIRY_KEY = 'sales_auth_expiry';
const SALES_BU_PREF_KEY = 'sales_auth_bu';
const SALES_ORG_PREF_KEY = 'sales_auth_org';

export function loadSalesAttributionPrefs(): { business_unit: string; organization: string } {
  return {
    business_unit: localStorage.getItem(SALES_BU_PREF_KEY) ?? '',
    organization: localStorage.getItem(SALES_ORG_PREF_KEY) ?? '',
  };
}

function saveSalesAttributionPrefs(business_unit: string, organization: string) {
  localStorage.setItem(SALES_BU_PREF_KEY, business_unit);
  localStorage.setItem(SALES_ORG_PREF_KEY, organization);
}

export function saveSalesSession(
  token: string,
  googleIdToken: string,
  user: SalesAuthUser,
  expiresInSeconds = 1800,
) {
  const expiry = Date.now() + expiresInSeconds * 1000;
  localStorage.setItem(SALES_TOKEN_KEY, token);
  persistSalesGoogleIdToken(googleIdToken);
  localStorage.setItem(SALES_USER_KEY, JSON.stringify(user));
  localStorage.setItem(SALES_EXPIRY_KEY, String(expiry));
  saveSalesAttributionPrefs(user.business_unit, user.organization);
}

export function loadSalesSession(): { token: string; googleIdToken: string; user: SalesAuthUser } | null {
  const token = localStorage.getItem(SALES_TOKEN_KEY);
  const googleIdToken = localStorage.getItem('sales_google_id_token') ?? '';
  const userRaw = localStorage.getItem(SALES_USER_KEY);
  const expiryRaw = localStorage.getItem(SALES_EXPIRY_KEY);

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
  localStorage.removeItem(SALES_TOKEN_KEY);
  localStorage.removeItem('sales_google_id_token');
  localStorage.removeItem('sales_google_id_token_fetched_at');
  localStorage.removeItem(SALES_USER_KEY);
  localStorage.removeItem(SALES_EXPIRY_KEY);
}

function getStoredSalesToken(): string | null {
  return localStorage.getItem(SALES_TOKEN_KEY);
}

/**
 * Authorization: Bearer <Google OIDC> — Cloud Run IAM (nginx → X-Serverless-Authorization).
 * x-app-auth: Bearer <app JWT> — Sales FastAPI (same pattern as Translation security.py).
 */
async function salesAuthHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const token = getStoredSalesToken();
  const googleIdToken = await ensureFreshSalesGoogleIdToken();
  return {
    accept: 'application/json',
    ...(googleIdToken ? { Authorization: `Bearer ${googleIdToken}` } : {}),
    ...(token ? { 'x-app-auth': `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function fetchSalesWithAuth(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, {
    ...init,
    headers: { ...(await salesAuthHeaders()), ...init.headers },
  });

  if (response.status === 401 || response.status === 403) {
    await forceRefreshSalesGoogleIdToken();
    response = await fetch(url, {
      ...init,
      headers: { ...(await salesAuthHeaders()), ...init.headers },
    });
  }

  return response;
}

async function parseSalesApiError(response: Response, fallback: string): Promise<string> {
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

/** GET /api/sales/v1/auth/whoami — IAP entitlement probe */
export async function fetchSalesWhoami(): Promise<{ email: string } | null> {
  const res = await fetch(`${SALES_API_BASE}/auth/whoami`, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

/** POST /api/sales/v1/auth/token */
export async function salesAuthenticate(
  business_unit: string,
  organization: string,
): Promise<SalesTokenResponse & { googleIdToken: string }> {
  const googleIdToken = await fetchSalesGoogleIdToken();
  persistSalesGoogleIdToken(googleIdToken);

  const res = await fetch(`${SALES_API_BASE}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      Authorization: `Bearer ${googleIdToken}`,
    },
    body: JSON.stringify({ business_unit, organization }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Authentication failed.' }));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return { ...data, googleIdToken };
}

/** POST /api/sales/v1/research/initiate */
export async function initiateResearch(
  account_id: string,
  company_name: string,
): Promise<InitiateResearchResponse> {
  const res = await fetchSalesWithAuth(`${SALES_API_BASE}/research/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id, company_name }),
  });

  if (!res.ok) {
    throw new Error(await parseSalesApiError(res, 'Failed to initiate research'));
  }

  return res.json();
}

/** GET /api/sales/v1/research/status/{job_id} */
export async function getResearchStatus(job_id: string): Promise<ResearchStatusResponse> {
  const res = await fetchSalesWithAuth(`${SALES_API_BASE}/research/status/${job_id}`, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(await parseSalesApiError(res, 'Failed to fetch status'));
  }

  return res.json();
}

/** GET /api/sales/v1/research/result/{job_id} */
export async function getResearchResult(job_id: string): Promise<ResearchResultResponse> {
  const res = await fetchSalesWithAuth(`${SALES_API_BASE}/research/result/${job_id}`, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(await parseSalesApiError(res, 'Failed to fetch result'));
  }

  return res.json();
}

/** GET /api/sales/v1/research/download/{job_id} */
export async function downloadResearchFile(job_id: string): Promise<void> {
  const res = await fetchSalesWithAuth(`${SALES_API_BASE}/research/download/${job_id}`, {
    method: 'GET',
    headers: { accept: '*/*' },
  });

  if (!res.ok) {
    throw new Error(await parseSalesApiError(res, 'Download failed'));
  }

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
