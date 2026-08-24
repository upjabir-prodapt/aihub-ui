import { fetchGoogleIdToken, persistGoogleIdToken } from './cloudRunAuth';
import {
  salesAuthenticate,
  saveSalesSession,
  type SalesAuthUser,
} from './salesAgentApi';
import { TRANSLATION_API_BASE } from './translationConfig';
import { saveSession, type AuthUser } from '../context/authStorage';
import type { ServiceEntitlements } from '../components/Sidebar';

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
        const expiresIn = data.expires_in ?? 3600;
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
        const expiresIn = 3600;
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
