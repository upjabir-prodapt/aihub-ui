/** Cloud Run identity tokens for Translation and Sales Agent APIs. */

import { CLOUD_RUN_IAM_AUDIENCE } from "@/modules/translation/translationConfig";
import { SALES_CLOUD_RUN_IAM_AUDIENCE } from "@/modules/sales-agent/salesConfig";

export type CloudRunIdentityConfig = {
  audience: string;
  googleTokenKey: string;
  fetchedAtKey: string;
  serviceName: string;
};

const GOOGLE_TOKEN_MAX_AGE_MS = 50 * 60 * 1000;
const LOCAL_DEV_MOCK_TOKEN = "mock_google_id_token_for_local_dev";

function isProdBuild(): boolean {
  return process.env.NODE_ENV === "production";
}

export function createCloudRunIdentity(config: CloudRunIdentityConfig) {
  const { audience, googleTokenKey, fetchedAtKey, serviceName } = config;

  function getStoredGoogleIdToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(googleTokenKey);
  }

  function persistGoogleIdToken(token: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(googleTokenKey, token);
    localStorage.setItem(fetchedAtKey, String(Date.now()));
  }

  async function fetchGoogleIdToken(): Promise<string> {
    try {
      const metaRes = await fetch(
        "/api/metadata/id-token?audience=" + encodeURIComponent(audience)
      );
      if (metaRes.ok) {
        const token = (await metaRes.text()).trim();
        if (token) return token;
        console.warn("[" + serviceName + "] Metadata returned empty identity token");
      } else {
        console.warn("[" + serviceName + "] Metadata status:", metaRes.status);
      }
    } catch (err) {
      console.warn("[" + serviceName + "] Metadata fetch failed:", err);
    }

    if (isProdBuild()) {
      throw new Error(
        "Could not obtain Cloud Run identity token for " + serviceName + ". " +
          "Ensure the UI runs on Cloud Run with a service account that can invoke the backend."
      );
    }

    console.warn("[" + serviceName + "] Using mock Google identity token (local dev only)");
    return LOCAL_DEV_MOCK_TOKEN;
  }

  function isGoogleTokenStale(): boolean {
    if (typeof window === "undefined") return true;
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

// Translation identity
const translationIdentity = createCloudRunIdentity({
  audience: CLOUD_RUN_IAM_AUDIENCE,
  googleTokenKey: "colt_google_id_token",
  fetchedAtKey: "colt_google_id_token_fetched_at",
  serviceName: "Translation",
});

export const {
  getStoredGoogleIdToken,
  persistGoogleIdToken,
  fetchGoogleIdToken,
  ensureFreshGoogleIdToken,
  forceRefreshGoogleIdToken,
} = translationIdentity;

// Sales Agent identity
const salesIdentity = createCloudRunIdentity({
  audience: SALES_CLOUD_RUN_IAM_AUDIENCE,
  googleTokenKey: "sales_google_id_token",
  fetchedAtKey: "sales_google_id_token_fetched_at",
  serviceName: "Sales Agent",
});

export const {
  getStoredSalesGoogleIdToken,
  persistSalesGoogleIdToken,
  fetchSalesGoogleIdToken,
  ensureFreshSalesGoogleIdToken,
  forceRefreshSalesGoogleIdToken,
} = {
  getStoredSalesGoogleIdToken: salesIdentity.getStoredGoogleIdToken,
  persistSalesGoogleIdToken: salesIdentity.persistGoogleIdToken,
  fetchSalesGoogleIdToken: salesIdentity.fetchGoogleIdToken,
  ensureFreshSalesGoogleIdToken: salesIdentity.ensureFreshGoogleIdToken,
  forceRefreshSalesGoogleIdToken: salesIdentity.forceRefreshGoogleIdToken,
};

/** Background refresh interval while sales session is active. */
export const SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;