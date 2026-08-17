import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/server/secrets/gcpSecretManager';
import { env } from '@/server/config/env';
import { exchangeCodeForTokens, decodeJwtClaims } from '@/server/entra/oidcClient';
import { encryptTokens } from '@/server/session/sessionCrypto';
import { createSession, generateRandomToken } from '@/server/session/sessionStore';
import { generateCsrfToken, attachCsrfToken } from '@/server/security/csrf';

/**
 * Handles the OIDC Callback redirect from Entra ID.
 * Performs authorization code exchange, session creation in Native Firestore,
 * and sets secure, HttpOnly __Host-AISESSION cookies with lax attribute + double-submit anti-CSRF cookie.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (error) {
    console.error(`OIDC flow error: ${error} - ${errorDescription}`);
    return NextResponse.redirect(new URL('/?error=auth_failed', req.url));
  }

  const code = searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/?error=missing_code', req.url));
  }

  try {
    // 1. Fetch Entra ID Client Secret dynamically from Secret Manager
    const clientSecret = await getSecret(env.ENTRA_CLIENT_SECRET_SECRET_NAME);

    // 2. Exchange authorization code for tokens
    const tokenResponse = await exchangeCodeForTokens(code, clientSecret);

    // 3. Extract user information claims
    const userClaims = decodeJwtClaims(tokenResponse.id_token);

    // 4. Secure tokens with KMS envelope encryption
    const encryptedTokens = await encryptTokens({
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
    });

    // 5. Generate secure 256-bit plain session ID
    const sessionId = generateRandomToken(32);

    // 6. Write stateful session document inside Firestore
    await createSession(
      sessionId,
      {
        email: userClaims.email,
        roles: userClaims.roles,
        oid: userClaims.oid,
        department: userClaims.department,
      },
      encryptedTokens
    );

    // 7. Redirect to root, emitting secure opaque session cookie
    const response = NextResponse.redirect(new URL('/', req.url));

    response.cookies.set('__Host-AISESSION', sessionId, {
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax', // Lax helps prevent redirection loops on bouncebacks
      maxAge: env.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60, // 8 hours absolute expiration
    });

    // 8. Generate and attach the anti-CSRF token double-submit cookie
    const csrfToken = generateCsrfToken();
    attachCsrfToken(response, csrfToken);

    return response;
  } catch (err) {
    console.error('OIDC callback route processing crash:', err);
    return NextResponse.redirect(new URL('/?error=session_error', req.url));
  }
}
