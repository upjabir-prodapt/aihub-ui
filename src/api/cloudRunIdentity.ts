/** Shared Cloud Run identity token client (metadata server / gcloud audience). */

export type CloudRunIdentityConfig = {
  audience: string;
  googleTokenKey: string;
  fetchedAtKey: string;
  serviceName: string;
};

const GOOGLE_TOKEN_MAX_AGE_MS = 50 * 60 * 1000;
const LOCAL_DEV_MOCK_TOKEN = 'mock_google_id_token_for_local_dev';

function isProdBuild(): boolean {
  return import.meta.env.PROD;
}

export function createCloudRunIdentity(config: CloudRunIdentityConfig) {
  const { audience, googleTokenKey, fetchedAtKey, serviceName } = config;

  function getStoredGoogleIdToken(): string | null {
    return localStorage.getItem(googleTokenKey);
  }

  function persistGoogleIdToken(token: string): void {
    localStorage.setItem(googleTokenKey, token);
    localStorage.setItem(fetchedAtKey, String(Date.now()));
  }

  async function fetchGoogleIdToken(): Promise<string> {
    try {
      const metaRes = await fetch(
        `/api/metadata/id-token?audience=${encodeURIComponent(audience)}`,
      );
      if (metaRes.ok) {
        const token = (await metaRes.text()).trim();
        if (token) return token;
        console.warn(`[${serviceName}] Metadata returned empty identity token`);
      } else {
        console.warn(`[${serviceName}] Metadata status:`, metaRes.status);
      }
    } catch (err) {
      console.warn(`[${serviceName}] Metadata fetch failed:`, err);
    }

    if (isProdBuild()) {
      throw new Error(
        `Could not obtain Cloud Run identity token for ${serviceName}. ` +
          'Ensure the UI runs on Cloud Run with a service account that can invoke the backend.',
      );
    }

    console.warn(`[${serviceName}] Using mock Google identity token (local dev only)`);
    return LOCAL_DEV_MOCK_TOKEN;
  }

  function isGoogleTokenStale(): boolean {
    const fetchedAtRaw = localStorage.getItem(fetchedAtKey);
    if (!fetchedAtRaw) return true;
    const age = Date.now() - parseInt(fetchedAtRaw, 10);
    return Number.isNaN(age) || age >= GOOGLE_TOKEN_MAX_AGE_MS;
  }

  async function ensureFreshGoogleIdToken(): Promise<string | null> {
    const existing = getStoredGoogleIdToken();
    if (existing && !isGoogleTokenStale()) {
      return existing;
    }
    const token = await fetchGoogleIdToken();
    persistGoogleIdToken(token);
    return token;
  }

  async function forceRefreshGoogleIdToken(): Promise<string> {
    const token = await fetchGoogleIdToken();
    persistGoogleIdToken(token);
    return token;
  }

  return {
    getStoredGoogleIdToken,
    persistGoogleIdToken,
    fetchGoogleIdToken,
    ensureFreshGoogleIdToken,
    forceRefreshGoogleIdToken,
  };
}
