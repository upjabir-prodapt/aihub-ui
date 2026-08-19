import { NextRequest, NextResponse } from 'next/server';
import { verifyIapRequest, hasGroup, IapAuthError, type IapIdentity } from '@/server/iap/verify';
import { encodeSessionCookie, decodeSessionCookie } from '@/server/session/sessionCookie';
import { env } from '@/server/config/env';

/**
 * Returns the caller's verified identity + per-service entitlements.
 *
 * Authentication itself is entirely handled by GCLB + IAP before the request
 * ever reaches this Cloud Run service — there is no separate login flow here.
 * This endpoint just:
 *   1. Verifies the `X-Goog-IAP-JWT-Assertion` header IAP injects (or reuses
 *      a still-fresh cached copy from the signed session cookie).
 *   2. Derives per-service entitlement from the IAP JWT's `groups` claim
 *      (populated via the workforce pool's `google.groups: assertion.groups`
 *      attribute mapping), matching the same TRANSLATION_REQUIRED_GROUP /
 *      SALES_REQUIRED_GROUP checks enforced server-side in the Translation
 *      and Sales Agent backends.
 */
export async function GET(req: NextRequest) {
  let identity: IapIdentity | null = decodeSessionCookie(
    req.cookies.get(env.SESSION_COOKIE_NAME)?.value,
  );

  let shouldRefreshCookie = false;

  if (!identity) {
    try {
      identity = await verifyIapRequest(req.headers, [env.HUB_IAP_AUDIENCE]);
      shouldRefreshCookie = true;
    } catch (err) {
      const status = err instanceof IapAuthError ? err.status : 401;
      return NextResponse.json({ authenticated: false }, { status });
    }
  }

  const entitlements = {
    translation: hasGroup(identity, env.TRANSLATION_REQUIRED_GROUP),
    sales: hasGroup(identity, env.SALES_REQUIRED_GROUP),
  };

  const response = NextResponse.json({
    authenticated: true,
    email: identity.email,
    groups: identity.groups,
    entitlements,
  });

  if (shouldRefreshCookie && env.SESSION_COOKIE_SECRET) {
    response.cookies.set(env.SESSION_COOKIE_NAME, encodeSessionCookie(identity), {
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: env.SESSION_TTL_SECONDS,
    });
  }

  return response;
}
