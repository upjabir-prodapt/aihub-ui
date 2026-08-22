export interface AuthUser {
  email: string;
  business_unit: string;
  organization: string;
}

// NOTE: the app-session JWT itself is NO LONGER stored here (or anywhere in
// localStorage). It now lives exclusively in the httpOnly `colt_session`
// cookie set by POST /auth/token, which JS cannot read — this is the
// hardening fix for the XSS-exfiltration risk of storing a bearer token in
// localStorage. What remains here is only non-sensitive UI state: the
// verified user's email/business_unit/organization (safe to display) and an
// expiry timestamp used purely to decide when to re-prompt for login.
//
// `colt_google_id_token` is a separate concern — it's the Cloud Run IAM
// invoker identity token for calling the backend's own Cloud Run URL, not
// this app's session-identity credential, so it is left as-is.
const GOOGLE_TOKEN_KEY = 'colt_google_id_token';
const USER_KEY = 'colt_auth_user';
const EXPIRY_KEY = 'colt_auth_expiry';
const BU_PREF_KEY = 'colt_auth_bu';
const ORG_PREF_KEY = 'colt_auth_org';

export function loadAttributionPrefs(): { business_unit: string; organization: string } {
  return {
    business_unit: localStorage.getItem(BU_PREF_KEY) ?? 'SBU',
    organization: localStorage.getItem(ORG_PREF_KEY) ?? 'Colt',
  };
}

function saveAttributionPrefs(business_unit: string, organization: string) {
  localStorage.setItem(BU_PREF_KEY, business_unit);
  localStorage.setItem(ORG_PREF_KEY, organization);
}

/**
 * Persist non-sensitive session state after a successful /auth/token call.
 * The JWT itself arrives via Set-Cookie (httpOnly) and is never touched here.
 */
export function saveSession(googleIdToken: string, user: AuthUser, expiresIn: number) {
  const expiry = Date.now() + expiresIn * 1000;
  localStorage.setItem(GOOGLE_TOKEN_KEY, googleIdToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(EXPIRY_KEY, String(expiry));
  saveAttributionPrefs(user.business_unit, user.organization);
}

export function loadSession(): { googleIdToken: string; user: AuthUser } | null {
  const googleIdToken = localStorage.getItem(GOOGLE_TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);
  const expiryRaw = localStorage.getItem(EXPIRY_KEY);

  if (!googleIdToken || !userRaw || !expiryRaw) return null;
  if (Date.now() > parseInt(expiryRaw, 10)) {
    clearSession();
    return null;
  }

  try {
    const user: AuthUser = JSON.parse(userRaw);
    return { googleIdToken, user };
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(GOOGLE_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}
