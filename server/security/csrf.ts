import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_COOKIE_NAME = 'xsrf-token';

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Attaches the CSRF token to a NextResponse as a client-readable cookie.
 */
export function attachCsrfToken(res: NextResponse, token: string): void {
  res.cookies.set(CSRF_COOKIE_NAME, token, {
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // Must be lax to let client load/send it
    maxAge: 8 * 60 * 60, // 8 hours matching absolute session lifetime
  });
}

/**
 * Validates double-submit cookie anti-CSRF patterns and request Origin/Referer.
 * Returns true if valid, false if verification failed.
 */
export function validateCsrf(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  // Safe methods do not require double-submit token validation
  if (['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)) {
    return true;
  }

  // 1. Strict Server-Side Origin/Referer Verification
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = req.headers.get('host') || 'localhost:8080';

  let expectedOrigin = `http://${host}`;
  if (process.env.NODE_ENV === 'production') {
    expectedOrigin = `https://${host}`;
  }

  if (origin) {
    if (origin !== expectedOrigin && !origin.startsWith(expectedOrigin)) {
      console.warn(`CSRF Origin mismatch: expected ${expectedOrigin}, got ${origin}`);
      return false;
    }
  } else if (referer) {
    if (!referer.startsWith(expectedOrigin) && !referer.startsWith(`http://${host}`) && !referer.startsWith(`https://${host}`)) {
      console.warn(`CSRF Referer mismatch: expected ${expectedOrigin}, got ${referer}`);
      return false;
    }
  } else {
    // Both missing on state-changing requests! Strict block.
    console.warn(`CSRF validation blocked: state-changing request missing both Origin and Referer headers.`);
    return false;
  }

  // 2. Double-Submit Cookie verification
  const csrfCookie = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = req.headers.get(CSRF_HEADER_NAME);

  if (!csrfCookie || !csrfHeader) {
    console.warn(`CSRF verification failed: missing cookie or header. Header: ${!!csrfHeader}, Cookie: ${!!csrfCookie}`);
    return false;
  }

  // Constant-time compare to mitigate timing attacks
  const bufCookie = Buffer.from(csrfCookie);
  const bufHeader = Buffer.from(csrfHeader);

  if (bufCookie.length !== bufHeader.length || !crypto.timingSafeEqual(bufCookie, bufHeader)) {
    console.warn('CSRF verification failed: cookie and header tokens do not match.');
    return false;
  }

  return true;
}
