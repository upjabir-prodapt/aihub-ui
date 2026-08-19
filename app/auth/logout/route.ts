import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/server/config/env';

/**
 * Logout endpoint.
 *
 * There's no local session state to destroy beyond the lightweight signed
 * cookie cache (IAP itself owns the actual authenticated session). Clearing
 * that cache cookie and redirecting to IAP's own clear-login-cookie endpoint
 * fully signs the user out, forcing a fresh IAP -> Entra challenge on the
 * next visit.
 */
export async function POST(req: NextRequest) {
  const response = NextResponse.redirect(new URL('/_gcp_iap/clear_login_cookie', req.url));
  response.cookies.set(env.SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return response;
}
