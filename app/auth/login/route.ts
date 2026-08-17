import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizationUrl } from '@/server/entra/oidcClient';

/**
 * Initiates the Entra ID confidential OIDC redirect flow.
 * Handles silent SSO with login_hint parameter if Google Cloud Identity-Aware Proxy (IAP) assertion is detected.
 */
export async function GET(req: NextRequest) {
  // Parse google IAP assertion to do silent single sign-on via login_hint
  const iapJwt = req.headers.get('x-goog-iap-jwt-assertion');
  let loginHint: string | null = null;

  if (iapJwt) {
    try {
      const parts = iapJwt.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        loginHint = payload.email || null;
      }
    } catch (err) {
      console.warn('Failed parsing IAP assertion for silent login hint:', err);
    }
  }

  const authorizationUrl = getAuthorizationUrl(loginHint);
  return NextResponse.redirect(authorizationUrl);
}
