/**
 * Lightweight signed-cookie session cache.
 *
 * IAP is the sole authority on authentication for this app — GCLB rejects
 * any request without a valid IAP session before it ever reaches Cloud Run.
 * This cookie is purely a perf/UX cache of the already-verified IAP claims
 * (email + groups) so we don't have to re-verify the JWT signature against
 * Google's certs on every single request. It carries no privileges of its
 * own: if it's missing, expired, or tampered with, we simply re-verify the
 * IAP JWT from the current request and re-issue it — never a fallback to
 * "trust the cookie alone."
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import type { IapIdentity } from '../iap/verify';

interface SessionPayload extends IapIdentity {
  iat: number; // issued-at (epoch seconds)
}

function sign(payload: string): string {
  return createHmac('sha256', env.SESSION_COOKIE_SECRET).update(payload).digest('base64url');
}

/** Serializes and signs the verified IAP identity into an opaque cookie value. */
export function encodeSessionCookie(identity: IapIdentity): string {
  const payload: SessionPayload = { ...identity, iat: Math.floor(Date.now() / 1000) };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(body);
  return `${body}.${signature}`;
}

/**
 * Verifies and decodes a session cookie value. Returns null if missing,
 * malformed, tampered with, or expired — callers must treat null exactly
 * like "no session" and fall back to verifying the IAP JWT directly.
 */
export function decodeSessionCookie(value: string | undefined | null): IapIdentity | null {
  if (!value || !env.SESSION_COOKIE_SECRET) return null;

  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expectedSignature = sign(body);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    const ageSeconds = Math.floor(Date.now() / 1000) - payload.iat;
    if (ageSeconds > env.SESSION_TTL_SECONDS) return null;
    return { email: payload.email, groups: payload.groups };
  } catch {
    return null;
  }
}
