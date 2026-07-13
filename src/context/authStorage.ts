export interface AuthUser {
  email: string;
  business_unit: string;
  organization: string;
}

const TOKEN_KEY = 'colt_auth_token';
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

export function saveSession(token: string, googleIdToken: string, user: AuthUser, expiresIn: number) {
  const expiry = Date.now() + expiresIn * 1000;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(GOOGLE_TOKEN_KEY, googleIdToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(EXPIRY_KEY, String(expiry));
  saveAttributionPrefs(user.business_unit, user.organization);
}

export function loadSession(): { token: string; googleIdToken: string; user: AuthUser } | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const googleIdToken = localStorage.getItem(GOOGLE_TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);
  const expiryRaw = localStorage.getItem(EXPIRY_KEY);

  if (!token || !googleIdToken || !userRaw || !expiryRaw) return null;
  if (Date.now() > parseInt(expiryRaw, 10)) {
    clearSession();
    return null;
  }

  try {
    const user: AuthUser = JSON.parse(userRaw);
    return { token, googleIdToken, user };
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GOOGLE_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}
