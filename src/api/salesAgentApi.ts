import type {
  SalesAuthUser,
  SalesTokenResponse,
  InitiateResearchResponse,
  ResearchStatusResponse,
  ResearchModelCard,
  ResearchResultResponse,
  ResearchJobListItem,
} from '../types/sales';
import {
  ensureFreshSalesGoogleIdToken,
  fetchSalesGoogleIdToken,
  forceRefreshSalesGoogleIdToken,
  persistSalesGoogleIdToken,
} from './salesCloudRunAuth';
import { SALES_API_BASE } from './salesConfig';
import type { SessionRenewal } from '../context/authStorage';

/** Fallback session lifetime if a response omits `expires_in` (both services mint 30 min). */
const DEFAULT_SESSION_SECONDS = 1800;

// ── Re-export Types ────────────────────────────────────────────────────────

export type {
  SalesAuthUser,
  SalesTokenResponse,
  InitiateResearchResponse,
  ResearchStatusResponse,
  ResearchModelCard,
  ResearchResultResponse,
  ResearchJobListItem,
};

// ── Session storage (isolated from Translation) ────────────────────────────
//
// NOTE: the app-session JWT is NO LONGER stored here (or anywhere in
// localStorage) — it now lives exclusively in the httpOnly `colt_session`
// cookie set by POST /auth/token, mirroring the Translation service's
// hardening fix. Only non-sensitive UI state (email/BU/org, expiry) remains.

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

/**
 * Push the locally-cached Sales expiry forward after a successful renewal.
 * Mirrors `saveAccessTokenExpiry()` on the Translation side: only the expiry
 * moves, since the renewed JWT arrives via Set-Cookie.
 */
export function saveSalesAccessTokenExpiry(expiresInSeconds: number) {
  localStorage.setItem(SALES_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000));
}

export function saveSalesSession(
  googleIdToken: string,
  user: SalesAuthUser,
  expiresInSeconds = DEFAULT_SESSION_SECONDS,
) {
  const expiry = Date.now() + expiresInSeconds * 1000;
  persistSalesGoogleIdToken(googleIdToken);
  localStorage.setItem(SALES_USER_KEY, JSON.stringify(user));
  localStorage.setItem(SALES_EXPIRY_KEY, String(expiry));
  saveSalesAttributionPrefs(user.business_unit, user.organization);
}

export function loadSalesSession(): { googleIdToken: string; user: SalesAuthUser } | null {
  const googleIdToken = localStorage.getItem('sales_google_id_token') ?? '';
  const userRaw = localStorage.getItem(SALES_USER_KEY);
  const expiryRaw = localStorage.getItem(SALES_EXPIRY_KEY);

  if (!userRaw || !expiryRaw) return null;
  if (Date.now() > parseInt(expiryRaw, 10)) {
    clearSalesSession();
    return null;
  }

  try {
    const user: SalesAuthUser = JSON.parse(userRaw);
    return { googleIdToken, user };
  } catch {
    return null;
  }
}

export function clearSalesSession() {
  localStorage.removeItem('sales_google_id_token');
  localStorage.removeItem('sales_google_id_token_fetched_at');
  localStorage.removeItem(SALES_USER_KEY);
  localStorage.removeItem(SALES_EXPIRY_KEY);
}

/**
 * Authorization: Bearer <Google OIDC> — Cloud Run IAM (nginx → X-Serverless-Authorization).
 * The app-session JWT is no longer attached manually here — it travels via
 * the httpOnly `colt_session` cookie automatically once `credentials: 'include'`
 * is set on the fetch call (see fetchSalesWithAuth below).
 */
async function salesAuthHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const googleIdToken = await ensureFreshSalesGoogleIdToken();
  return {
    accept: 'application/json',
    ...(googleIdToken ? { Authorization: `Bearer ${googleIdToken}` } : {}),
    ...extra,
  };
}

async function fetchSalesWithAuth(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { ...(await salesAuthHeaders()), ...init.headers },
  });

  if (response.status === 401 || response.status === 403) {
    await forceRefreshSalesGoogleIdToken();
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: { ...(await salesAuthHeaders()), ...init.headers },
    });
  }

  return response;
}

async function parseSalesApiError(response: Response, fallback: string): Promise<string> {
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

/** GET /api/sales/v1/auth/whoami — IAP entitlement probe */
export async function fetchSalesWhoami(): Promise<{ email: string } | null> {
  const res = await fetch(`${SALES_API_BASE}/auth/whoami`, { credentials: 'include' });
  if (!res.ok) return null;
  return (await res.json()) as { email: string };
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
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      Authorization: `Bearer ${googleIdToken}`,
    },
    body: JSON.stringify({ business_unit, organization }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ detail: 'Authentication failed.' }))) as {
      detail?: string;
      message?: string;
    };
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as SalesTokenResponse;
  return { ...data, googleIdToken };
}

/**
 * POST /api/sales/v1/auth/refresh — slide the shared session forward.
 *
 * Sent with NO request body, exactly as on the Translation side: the endpoint
 * takes none, and the still-valid `colt_session` cookie is the whole
 * credential. Deliberately uses a bare `fetch` rather than
 * `fetchSalesWithAuth`, whose 401/403 retry would re-issue a renewal that has
 * already been definitively refused.
 */
export async function refreshSalesSession(): Promise<SessionRenewal> {
  let res: Response;
  try {
    res = await fetch(`${SALES_API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: await salesAuthHeaders(),
    });
  } catch {
    // Offline, DNS failure, proxy hiccup — the session may well still be
    // valid, so report transient rather than ending it.
    return { status: 'unavailable' };
  }

  if (res.status === 401 || res.status === 403) {
    // Past the 8-hour cap, already expired, or entitlement revoked. The
    // server has cleared the cookie; the session is over.
    return { status: 'expired' };
  }

  if (!res.ok) return { status: 'unavailable' };

  try {
    const data = (await res.json()) as { expires_in?: number };
    return { status: 'renewed', expiresIn: data.expires_in ?? DEFAULT_SESSION_SECONDS };
  } catch {
    // The renewal itself succeeded and Set-Cookie has landed; only the body
    // was unreadable. Assume the standard lifetime rather than discarding it.
    return { status: 'renewed', expiresIn: DEFAULT_SESSION_SECONDS };
  }
}

/**
 * POST /api/sales/v1/auth/logout — clear the server-set session cookie.
 * Never throws: logout must proceed locally even if the request fails.
 */
export async function logoutSalesSession(): Promise<void> {
  try {
    await fetch(`${SALES_API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: await salesAuthHeaders(),
    });
  } catch {
    // Best effort — the local session is cleared regardless.
  }
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

  return (await res.json()) as InitiateResearchResponse;
}

/** GET /api/sales/v1/research/status/{job_id} */
export async function getResearchStatus(job_id: string): Promise<ResearchStatusResponse> {
  const res = await fetchSalesWithAuth(`${SALES_API_BASE}/research/status/${job_id}`, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(await parseSalesApiError(res, 'Failed to fetch status'));
  }

  return (await res.json()) as ResearchStatusResponse;
}

/** GET /api/sales/v1/research/result/{job_id} */
export async function getResearchResult(job_id: string): Promise<ResearchResultResponse> {
  const res = await fetchSalesWithAuth(`${SALES_API_BASE}/research/result/${job_id}`, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(await parseSalesApiError(res, 'Failed to fetch result'));
  }

  return (await res.json()) as ResearchResultResponse;
}

/**
 * GET /api/sales/v1/research/jobs — this user's research runs.
 *
 * The backend only retains the last 7 days (older runs and their generated
 * output files are purged), so this is inherently a rolling window; the UI
 * does not filter by date on top of it.
 */
export async function listResearchJobs(): Promise<ResearchJobListItem[]> {
  const res = await fetchSalesWithAuth(`${SALES_API_BASE}/research/jobs`, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(await parseSalesApiError(res, 'Failed to fetch research history'));
  }

  const data = (await res.json()) as { jobs?: ResearchJobListItem[] } | ResearchJobListItem[];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.jobs)) return data.jobs;
  return [];
}

/** DELETE /api/sales/v1/research/{job_id} — cancel a running research job. */
export async function cancelResearch(job_id: string): Promise<{ message: string }> {
  const res = await fetchSalesWithAuth(`${SALES_API_BASE}/research/${job_id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    throw new Error(await parseSalesApiError(res, 'Failed to cancel research job'));
  }

  return (await res.json().catch(() => ({ message: 'Cancelled' }))) as { message: string };
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
