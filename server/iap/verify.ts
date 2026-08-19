/**
 * GCP IAP JWT verification for Entra-federated user identity — Next.js server-side
 * equivalent of the Python `iap_auth.py` used by Translation and Sales-Agent.
 *
 * Since GCLB + IAP is enabled directly on the `aihub` backend service, every
 * request that reaches this Next.js app has ALREADY been authenticated by
 * IAP (via the Workforce Identity Federation -> Entra ID flow). There is no
 * separate OIDC login/callback needed here — we simply verify the
 * `X-Goog-IAP-JWT-Assertion` header IAP injects on every request, and derive
 * the user's identity + Entra group memberships (via the workforce pool's
 * `google.groups: assertion.groups` attribute mapping) from its claims.
 */

import { OAuth2Client } from 'google-auth-library';

const IAP_JWT_HEADER = 'x-goog-iap-jwt-assertion';
const IAP_CERTS_URL = 'https://www.gstatic.com/iap/verify/public_key';

const oAuth2Client = new OAuth2Client();

export interface IapIdentity {
  email: string;
  groups: string[];
}

export class IapAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith('@colt.net')) {
    throw new IapAuthError('Only @colt.net email addresses are allowed', 403);
  }
  return normalized;
}

function normalizeGroups(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,]+/)
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.map((g) => String(g).trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

/**
 * Verifies an IAP-signed JWT against one of the provided audiences (tries
 * each in turn — mirrors the Python backends accepting both their own
 * IAP_AUDIENCE and the shared HUB_IAP_AUDIENCE).
 */
async function verifyAgainstAudiences(
  assertion: string,
  audiences: string[],
): Promise<Record<string, unknown>> {
  let lastErr: unknown = null;
  for (const audience of audiences) {
    if (!audience) continue;
    try {
      const ticket = await oAuth2Client.verifySignedJwtWithCertsAsync(
        assertion,
        await (async () => {
          const res = await fetch(IAP_CERTS_URL);
          return res.json() as Promise<Record<string, string>>;
        })(),
        audience,
        ['https://cloud.google.com/iap'],
      );
      return ticket.getPayload() as unknown as Record<string, unknown>;

    } catch (err) {
      lastErr = err;
    }
  }
  throw new IapAuthError(
    `Invalid or missing IAP identity token: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/**
 * Verifies the IAP JWT on an incoming request and returns the caller's
 * verified email + Entra group memberships.
 *
 * @param headers Incoming request headers (Next.js `Headers` or plain object).
 * @param audiences One or more expected `aud` values (this app's own IAP
 *   OAuth client ID). Only one match is required.
 */
export async function verifyIapRequest(
  headers: Headers,
  audiences: string[],
): Promise<IapIdentity> {
  const assertion = headers.get(IAP_JWT_HEADER);
  if (!assertion) {
    throw new IapAuthError('Missing X-Goog-IAP-JWT-Assertion header', 401);
  }

  const claims = await verifyAgainstAudiences(assertion, audiences);

  const rawEmail = (claims.email as string) || (claims.sub as string);
  if (!rawEmail) {
    throw new IapAuthError('IAP token missing email claim', 401);
  }

  const email = normalizeEmail(rawEmail);
  const groups = normalizeGroups(claims.groups);
  return { email, groups };
}

/** True if the identity's groups include the given required group (case-insensitive). */
export function hasGroup(identity: IapIdentity, requiredGroup: string): boolean {
  if (!requiredGroup) return false;
  return identity.groups.includes(requiredGroup.trim().toLowerCase());
}
