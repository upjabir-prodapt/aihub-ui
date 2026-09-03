import {
  ensureFreshGoogleIdToken,
  fetchGoogleIdToken,
  persistGoogleIdToken,
} from './cloudRunAuth';
import {
  salesAuthenticate,
  saveSalesSession,
  type SalesAuthUser,
} from './salesAgentApi';
import { TRANSLATION_API_BASE } from './translationConfig';
import {
  saveSession,
  type AuthUser,
  type SessionRenewal,
} from '../context/authStorage';
import type { ServiceEntitlements } from '../components/Sidebar';

/** Fallback session lifetime if a response omits `expires_in` (both services mint 30 min). */
const DEFAULT_SESSION_SECONDS = 1800;

/**
 * Cloud Run IAM invoker identity, same as every other Translation call.
 * Separate concern from the `colt_session` cookie: this gets the request
 * through the network gate, the cookie proves who the user is.
 */
async function translationAuthHeaders(): Promise<Record<string, string>> {
  const googleIdToken = await ensureFreshGoogleIdToken();
  return {
    accept: 'application/json',
    ...(googleIdToken ? { Authorization: `Bearer ${googleIdToken}` } : {}),
  };
}

export interface HubLoginResult {
  translation?: {
    user: AuthUser;
    googleIdToken: string;
    expiresIn: number;
  };
  sales?: {
    user: SalesAuthUser;
    googleIdToken: string;
    expiresIn: number;
  };
  errors: string[];
}

export function isHubLoginComplete(
  entitlements: ServiceEntitlements,
  translationAuthenticated: boolean,
  salesAuthenticated: boolean,
): boolean {
  const needsTranslation = entitlements.translation;
  const needsSales = entitlements.sales;
  if (!needsTranslation && !needsSales) return false;
  if (needsTranslation && !translationAuthenticated) return false;
  if (needsSales && !salesAuthenticated) return false;
  return true;
}

/**
 * POST /api/translation/v1/auth/refresh — slide the shared session forward.
 *
 * Sent with NO request body: the endpoint takes none, and the still-valid
 * `colt_session` cookie (carried by `credentials: 'include'`) is the entire
 * credential. There is no refresh token; renewal only works while the current
 * token is alive, which is why the caller runs on a 25-minute timer against a
 * 30-minute token rather than waiting for expiry.
 */
export async function refreshTranslationSession(): Promise<SessionRenewal> {
  let response: Response;
  try {
    response = await fetch(`${TRANSLATION_API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: await translationAuthHeaders(),
    });
  } catch {
    // Offline, DNS failure, proxy hiccup — the session may well still be
    // valid, so report transient rather than ending it.
    return { status: 'unavailable' };
  }

  if (response.status === 401 || response.status === 403) {
    // Past the 8-hour cap, already expired, or entitlement revoked. The
    // server has cleared the cookie; the session is over.
    return { status: 'expired' };
  }

  if (!response.ok) return { status: 'unavailable' };

  try {
    const data = (await response.json()) as { expires_in?: number };
    return { status: 'renewed', expiresIn: data.expires_in ?? DEFAULT_SESSION_SECONDS };
  } catch {
    // The renewal itself succeeded and Set-Cookie has landed; only the body
    // was unreadable. Assume the standard lifetime rather than discarding it.
    return { status: 'renewed', expiresIn: DEFAULT_SESSION_SECONDS };
  }
}

/**
 * POST /api/translation/v1/auth/logout — clear the server-set session cookie.
 *
 * The cookie is httpOnly, so clearing localStorage alone would leave a live
 * credential in the browser that JS cannot touch. Never throws: logout must
 * proceed locally even if the request fails.
 */
export async function logoutTranslationSession(): Promise<void> {
  try {
    await fetch(`${TRANSLATION_API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: await translationAuthHeaders(),
    });
  } catch {
    // Best effort — the local session is cleared regardless.
  }
}

export async function hubLogin(
  business_unit: string,
  organization: string,
  entitlements: ServiceEntitlements,
): Promise<HubLoginResult> {
  const bu = business_unit.trim();
  const org = organization.trim();
  const result: HubLoginResult = { errors: [] };
  const tasks: Promise<void>[] = [];

  if (entitlements.translation) {
    tasks.push((async () => {
      try {
        const googleIdToken = await fetchGoogleIdToken();
        persistGoogleIdToken(googleIdToken);

        // credentials: 'include' — the response sets the httpOnly
        // `colt_session` cookie (Set-Cookie), which the browser stores
        // automatically; we never read the JWT out of the response body
        // for storage purposes (see authStorage.ts).
        const response = await fetch(`${TRANSLATION_API_BASE}/auth/token`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            accept: 'application/json',
            Authorization: `Bearer ${googleIdToken}`,
          },
          body: JSON.stringify({ business_unit: bu, organization: org }),
        });

        if (!response.ok) {
          const err = (await response.json().catch(() => ({ detail: 'Authentication failed.' }))) as {
            detail?: string;
            message?: string;
          };
          throw new Error(err.detail || err.message || `HTTP ${response.status}`);
        }

        const data = (await response.json()) as { email: string; expires_in?: number };
        const user: AuthUser = {
          email: data.email,
          business_unit: bu,
          organization: org,
        };
        const expiresIn = data.expires_in ?? DEFAULT_SESSION_SECONDS;
        saveSession(googleIdToken, user, expiresIn);
        result.translation = {
          user,
          googleIdToken,
          expiresIn,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Authentication failed.';
        result.errors.push(`Translation: ${message}`);
      }
    })());
  }

  if (entitlements.sales) {
    tasks.push((async () => {
      try {
        const data = await salesAuthenticate(bu, org);
        const user: SalesAuthUser = {
          email: data.email,
          business_unit: bu,
          organization: org,
        };
        // Use the lifetime the server actually minted. The previous hardcoded
        // 3600 outlived the 30-minute token, so the UI believed a dead session
        // was still good and only found out on the next 401.
        const expiresIn = data.expires_in ?? DEFAULT_SESSION_SECONDS;
        saveSalesSession(data.googleIdToken, user, expiresIn);
        result.sales = {
          user,
          googleIdToken: data.googleIdToken,
          expiresIn,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Authentication failed.';
        result.errors.push(`Sales: ${message}`);
      }
    })());
  }

  if (tasks.length === 0) {
    result.errors.push('No services are available to sign in.');
    return result;
  }

  await Promise.all(tasks);
  return result;
}
