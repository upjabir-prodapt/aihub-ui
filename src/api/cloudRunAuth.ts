/** Cloud Run invoker identity token (service account via metadata / gcloud). */

import { CLOUD_RUN_IAM_AUDIENCE } from './translationConfig';

const CLOUD_RUN_AUDIENCE = CLOUD_RUN_IAM_AUDIENCE;

const GOOGLE_TOKEN_KEY = 'colt_google_id_token';
const GOOGLE_TOKEN_FETCHED_AT_KEY = 'colt_google_id_token_fetched_at';

/** Refresh before Google OIDC expiry (~1h). */
const GOOGLE_TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

const LOCAL_DEV_MOCK_TOKEN = 'mock_google_id_token_for_local_dev';

function isProdBuild(): boolean {
  return import.meta.env.PROD;
}

export function getStoredGoogleIdToken(): string | null {
  return sessionStorage.getItem(GOOGLE_TOKEN_KEY);
}

export function persistGoogleIdToken(token: string): void {
  sessionStorage.setItem(GOOGLE_TOKEN_KEY, token);
  sessionStorage.setItem(GOOGLE_TOKEN_FETCHED_AT_KEY, String(Date.now()));
}

export async function fetchGoogleIdToken(): Promise<string> {
  try {
    const metaRes = await fetch(
      `/api/metadata/id-token?audience=${encodeURIComponent(CLOUD_RUN_AUDIENCE)}`,
    );
    if (metaRes.ok) {
      const token = (await metaRes.text()).trim();
      if (token) return token;
      console.warn('Metadata endpoint returned an empty identity token');
    } else {
      console.warn('Metadata endpoint returned status:', metaRes.status);
    }
  } catch (err) {
    console.warn('Failed to reach metadata endpoint:', err);
  }

  if (isProdBuild()) {
    throw new Error(
      'Could not obtain Cloud Run identity token. Ensure the UI runs on Cloud Run with a service account that can invoke Translation.',
    );
  }

  console.warn('Using mock Google identity token (local dev only)');
  return LOCAL_DEV_MOCK_TOKEN;
}

function isGoogleTokenStale(): boolean {
  const fetchedAtRaw = sessionStorage.getItem(GOOGLE_TOKEN_FETCHED_AT_KEY);
  if (!fetchedAtRaw) return true;
  const age = Date.now() - parseInt(fetchedAtRaw, 10);
  return Number.isNaN(age) || age >= GOOGLE_TOKEN_MAX_AGE_MS;
}

/** Return a fresh-enough Google token; refetch from metadata when stale or missing. */
export async function ensureFreshGoogleIdToken(): Promise<string | null> {
  const existing = getStoredGoogleIdToken();
  if (existing && !isGoogleTokenStale()) {
    return existing;
  }
  const token = await fetchGoogleIdToken();
  persistGoogleIdToken(token);
  return token;
}

/** Force metadata refetch (e.g. after Cloud Run 401/403). */
export async function forceRefreshGoogleIdToken(): Promise<string> {
  const token = await fetchGoogleIdToken();
  persistGoogleIdToken(token);
  return token;
}
