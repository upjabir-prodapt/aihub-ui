/**
 * Server-side environment configuration.
 *
 * This app runs entirely behind GCLB + IAP (Workforce Identity Federation via
 * Entra ID) — see docs/architecture-iap.md. There is no direct OIDC client of
 * our own; IAP has already authenticated every request that reaches this
 * service. The values below are only what's needed to (a) verify IAP JWTs on
 * inbound requests and (b) mint outbound IAP-authenticated identity tokens
 * when proxying to the Translation / Sales Agent backends.
 */

export const env = {
  // GCP project this Cloud Run service runs in (for logging/diagnostics only).
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || '',

  // This service's own IAP OAuth client ID(s) — the `aud` claim IAP stamps on
  // requests to the `aihub` backend service. Accept both the aihub audience
  // (normal path) for symmetry with the Python backends' HUB_IAP_AUDIENCE.
  HUB_IAP_AUDIENCE: process.env.HUB_IAP_AUDIENCE || '',

  // Target IAP OAuth client IDs for the Translation / Sales Agent backend
  // services — used as the `audience` when this server mints its own
  // identity token to call them (server-to-server, not via the browser).
  TRANSLATION_IAP_AUDIENCE: process.env.TRANSLATION_IAP_AUDIENCE || '',
  SALES_IAP_AUDIENCE: process.env.SALES_IAP_AUDIENCE || '',

  // Backend origins this server proxies /api/translation and /api/sales to.
  TRANSLATION_API_ORIGIN: process.env.TRANSLATION_API_ORIGIN || '',
  SALES_API_ORIGIN: process.env.SALES_API_ORIGIN || '',

  // Entra security groups required for entitlement (mirrors
  // TRANSLATION_REQUIRED_GROUP / SALES_REQUIRED_GROUP in the Python backends).
  TRANSLATION_REQUIRED_GROUP: process.env.TRANSLATION_REQUIRED_GROUP || '',
  SALES_REQUIRED_GROUP: process.env.SALES_REQUIRED_GROUP || '',

  // Secret used to sign the lightweight session cookie that caches verified
  // IAP claims for the browser session (purely a perf/UX cache — IAP is the
  // actual authority on every request regardless of this cookie's presence).
  SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET || '',
  SESSION_COOKIE_NAME: '__Host-AIHUB-SESSION',
  SESSION_TTL_SECONDS: 60 * 60, // 1 hour — re-derived from IAP JWT on expiry, cheap to refresh.
};
