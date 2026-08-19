import { saveSession, type AuthUser } from '@/modules/auth/authStorage';
import { saveSalesSession, type SalesAuthUser } from '@/modules/sales-agent/salesAgentApi';
import { TRANSLATION_API_BASE } from '@/modules/translation/translationConfig';
import { SALES_API_BASE } from '@/modules/sales-agent/salesConfig';
import type { ServiceEntitlements } from '@/modules/shell/Sidebar';

/**
 * Hub-level login: exchanges cost-attribution details (business unit /
 * organization) for a per-service app JWT.
 *
 * NOTE: unlike the previous Vite SPA, there is no separate Cloud Run
 * identity-token dance here. The browser's IAP session for the `aihub`
 * resource is sufficient — every call to `/api/translation/v1/*` and
 * `/api/sales/v1/*` is proxied through THIS Next.js server (see
 * app/api/translation/v1/[...path]/route.ts), which authenticates to those
 * backends itself using its own Cloud Run service account's IAP identity
 * token. The browser never talks to Translation/Sales directly.
 */

export interface HubLoginResult {
  translation?: { user: AuthUser; token: string; expiresIn: number };
  sales?: { user: SalesAuthUser; token: string; expiresIn: number };
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
    tasks.push(
      (async () => {
        try {
          const response = await fetch(`${TRANSLATION_API_BASE}/auth/token`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ business_unit: bu, organization: org }),
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: 'Authentication failed.' }));
            throw new Error(err.detail || err.error || `HTTP ${response.status}`);
          }

          const data = await response.json();
          const user: AuthUser = { email: data.email, business_unit: bu, organization: org };
          const expiresIn = data.expires_in ?? 3600;
          saveSession(data.access_token, user, expiresIn);
          result.translation = { user, token: data.access_token, expiresIn };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Authentication failed.';
          result.errors.push(`Translation: ${message}`);
        }
      })(),
    );
  }

  if (entitlements.sales) {
    tasks.push(
      (async () => {
        try {
          const response = await fetch(`${SALES_API_BASE}/auth/token`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ business_unit: bu, organization: org }),
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: 'Authentication failed.' }));
            throw new Error(err.detail || err.error || `HTTP ${response.status}`);
          }

          const data = await response.json();
          const user: SalesAuthUser = { email: data.email, business_unit: bu, organization: org };
          const expiresIn = 3600;
          saveSalesSession(data.access_token, user, expiresIn);
          result.sales = { user, token: data.access_token, expiresIn };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Authentication failed.';
          result.errors.push(`Sales: ${message}`);
        }
      })(),
    );
  }

  if (tasks.length === 0) {
    result.errors.push('No services are available to sign in.');
    return result;
  }

  await Promise.all(tasks);
  return result;
}
