import { NextRequest, NextResponse } from 'next/server';
import { destroySession } from '@/server/session/sessionStore';
import { validateCsrf } from '@/server/security/csrf';

/**
 * Log out endpoint. Must be POST-only and CSRF double-submit protected.
 * Destroys the stateful session in Firestore, clears the HTTP cookies,
 * and redirects to GCP IAP clear-session route.
 */
export async function POST(req: NextRequest) {
  // Anti-CSRF verification
  if (!validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF token mismatch or unauthorized origin.' }, { status: 403 });
  }

  const sessionId = req.cookies.get('__Host-AISESSION')?.value;

  try {
    if (sessionId) {
      await destroySession(sessionId);
    }
  } catch (err) {
    console.warn('Silent issue deleting session document from Firestore during logout:', err);
  }

  // Clear HTTP opaque cookies and redirect to IAP logout path
  // redirecting to IAP clear session URI fully destroys federated access
  const response = NextResponse.redirect(new URL('/_gcp_iap/clear_login_cookie', req.url));

  response.cookies.set('__Host-AISESSION', '', { path: '/', maxAge: 0 });
  response.cookies.set('xsrf-token', '', { path: '/', maxAge: 0 });

  return response;
}
