import { Firestore } from '@google-cloud/firestore';
import crypto from 'crypto';
import { env } from '../config/env';

export interface UserSession {
  email: string;
  roles: string[];
  oid: string;
  department: string;
  /** Fetched from Microsoft Graph /me alongside department — see server/entra/oidcClient.ts getDepartmentAndCompany(). */
  companyName: string;
  encryptedTokens: string;

  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
  idleExpiresAt: string;
  supersededBy?: string | null;
  supersededAt?: string | null;
  refreshLeaseUntil?: string | null;
}

const firestore = new Firestore({ projectId: env.GCP_PROJECT_ID });
const sessionCollection = firestore.collection('sessions');

/** Helper to generate a SHA-256 hash of a session ID (to secure document keys) */
export function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

/** Generate a random cryptographically secure 256-bit token */
export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Creates a brand new stateful session inside Firestore.
 */
export async function createSession(
  sessionId: string,
  user: { email: string; roles: string[]; oid: string; department: string; companyName: string },
  encryptedTokens: string
): Promise<UserSession> {
  const hashedId = hashSessionId(sessionId);
  const now = new Date();

  const absoluteExpiresAt = new Date(now.getTime() + env.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000);
  const idleExpiresAt = new Date(now.getTime() + env.SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000);

  const sessionData: UserSession = {
    email: user.email,
    roles: user.roles,
    oid: user.oid,
    department: user.department,
    companyName: user.companyName,
    encryptedTokens,

    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    absoluteExpiresAt: absoluteExpiresAt.toISOString(),
    idleExpiresAt: idleExpiresAt.toISOString(),
    supersededBy: null,
    supersededAt: null,
    refreshLeaseUntil: null,
  };

  await sessionCollection.doc(hashedId).set(sessionData);
  return sessionData;
}

/**
 * Fetches and validates a session.
 * Handles: timeouts, grace rotation window, idle extensions.
 */
export async function getSession(sessionId: string): Promise<{ session: UserSession; actualHashedId: string } | null> {
  const hashedId = hashSessionId(sessionId);
  let docRef = sessionCollection.doc(hashedId);
  let doc = await docRef.get();

  if (!doc.exists) {
    return null;
  }

  let session = doc.data() as UserSession;
  const now = new Date();

  // 1. Check if the session is superseded and within the 30-second read-only grace window
  if (session.supersededBy && session.supersededAt) {
    const supersededTime = new Date(session.supersededAt);
    if (now.getTime() - supersededTime.getTime() < 30 * 1000) {
      // Return the superseded session for backward compatibility for ongoing in-flight requests
      const nextHashed = hashSessionId(session.supersededBy);
      const nextDoc = await sessionCollection.doc(nextHashed).get();
      if (nextDoc.exists) {
        return { session: nextDoc.data() as UserSession, actualHashedId: nextHashed };
      }
    }
    // Expired grace window
    await docRef.delete();
    return null;
  }

  // 2. Validate absolute timeout
  if (now > new Date(session.absoluteExpiresAt)) {
    await docRef.delete();
    return null;
  }

  // 3. Validate idle timeout
  if (now > new Date(session.idleExpiresAt)) {
    await docRef.delete();
    return null;
  }

  // 4. Rate-limit lastSeenAt updates (max once per minute) to protect Firestore write limits
  const lastSeen = new Date(session.lastSeenAt);
  if (now.getTime() - lastSeen.getTime() > 60 * 1000) {
    const newIdleExpiresAt = new Date(now.getTime() + env.SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000);
    session.lastSeenAt = now.toISOString();
    session.idleExpiresAt = newIdleExpiresAt.toISOString();

    await docRef.update({
      lastSeenAt: session.lastSeenAt,
      idleExpiresAt: session.idleExpiresAt,
    });
  }

  return { session, actualHashedId: hashedId };
}

/**
 * Destroys/Deletes a session from Firestore.
 */
export async function destroySession(sessionId: string): Promise<void> {
  const hashedId = hashSessionId(sessionId);
  await sessionCollection.doc(hashedId).delete();
}

/**
 * Executes token refresh stampede lease check inside a Firestore transaction.
 * Returns true if a refresh lease is acquired.
 */
export async function acquireRefreshLease(hashedId: string): Promise<boolean> {
  const docRef = sessionCollection.doc(hashedId);
  const now = new Date();

  try {
    return await firestore.runTransaction(async (transaction: any) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return false;

      const session = doc.data() as UserSession;
      if (session.refreshLeaseUntil) {
        const leaseUntil = new Date(session.refreshLeaseUntil);
        if (now < leaseUntil) {
          return false; // Active lease exists, back off
        }
      }

      // Lock session refresh for 10 seconds
      const nextLease = new Date(now.getTime() + 10 * 1000);
      transaction.update(docRef, { refreshLeaseUntil: nextLease.toISOString() });
      return true;
    });
  } catch (err) {
    console.error('Firestore transaction failed acquiring refresh lease:', err);
    return false;
  }
}

/**
 * Release the active lease and update the encrypted session tokens.
 */
export async function releaseRefreshLeaseAndUpdate(
  hashedId: string,
  encryptedTokens: string
): Promise<void> {
  await sessionCollection.doc(hashedId).update({
    encryptedTokens,
    refreshLeaseUntil: null,
  });
}

/**
 * Rotates the session ID (grace window).
 * Marks the old session as superseded, pointing to the new session ID for a 30s window.
 */
export async function rotateSessionId(
  oldSessionId: string,
  newSessionId: string,
  session: UserSession
): Promise<void> {
  const oldHashed = hashSessionId(oldSessionId);
  const newHashed = hashSessionId(newSessionId);
  const now = new Date();

  // Create the new session
  const newSession: UserSession = {
    ...session,
    createdAt: session.createdAt, // Maintain original absolute timestamps
    refreshLeaseUntil: null,
    supersededBy: null,
    supersededAt: null,
  };

  // Run in parallel
  await Promise.all([
    sessionCollection.doc(newHashed).set(newSession),
    sessionCollection.doc(oldHashed).update({
      supersededBy: newSessionId,
      supersededAt: now.toISOString(),
    }),
  ]);
}
