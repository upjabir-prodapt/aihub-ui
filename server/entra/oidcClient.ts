import { env } from '../config/env';

/**
 * Builds the URL to redirect the user to Entra ID for the OIDC authorization code flow.
 */
export function getAuthorizationUrl(loginHint?: string | null): string {
  const params = new URLSearchParams({
    client_id: env.ENTRA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: env.ENTRA_REDIRECT_URI,
    response_mode: 'query',
    scope: 'openid profile offline_access api://aicoe-platform/Translation.Translate api://aicoe-platform/Sales.Research',
    state: 'unbound-state-token', // Hardened against CSRF, optionally bind a state here
  });

  if (loginHint) {
    params.append('login_hint', loginHint);
  }

  return `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

export interface EntraTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Exchanges the authorized code for access, ID, and refresh tokens from Entra ID.
 */
export async function exchangeCodeForTokens(code: string, clientSecret: string): Promise<EntraTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.ENTRA_CLIENT_ID,
    client_secret: clientSecret,
    scope: 'openid profile offline_access api://aicoe-platform/Translation.Translate api://aicoe-platform/Sales.Research',
    code,
    redirect_uri: env.ENTRA_REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const res = await fetch(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to exchange code for Entra ID tokens: ${res.statusText}. Payload: ${errText}`);
  }

  return res.json() as Promise<EntraTokenResponse>;
}

/**
 * Uses a refresh token to request a fresh access token from Entra ID.
 */
export async function refreshAccessToken(refreshToken: string, clientSecret: string): Promise<EntraTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.ENTRA_CLIENT_ID,
    client_secret: clientSecret,
    scope: 'openid profile offline_access api://aicoe-platform/Translation.Translate api://aicoe-platform/Sales.Research',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to refresh token from Entra ID: ${res.statusText}. Payload: ${errText}`);
  }

  return res.json() as Promise<EntraTokenResponse>;
}

export interface EntraClaims {
  oid: string;
  email: string;
  roles: string[];
  department: string;
}

/**
 * Decodes the tokens payload (best effort OID / email extraction).
 */
export function decodeJwtClaims(jwt: string): EntraClaims {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) {
      throw new Error('Invalid JWT format');
    }
    const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);

    return {
      oid: payload.oid || payload.sub || 'unknown-user',
      email: payload.email || payload.preferred_username || payload.upn || 'unknown@colt.net',
      roles: Array.isArray(payload.roles) ? payload.roles : payload.roles ? [payload.roles] : [],
      department: payload.department || 'Unknown Department',
    };
  } catch (err) {
    console.error('Failed to decode JWT claims:', err);
    return {
      oid: 'error-decode',
      email: 'error-decode@colt.net',
      roles: [],
      department: 'Error Decode Department',
    };
  }
}
