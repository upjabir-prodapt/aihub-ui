/**
 * Translation API host (internal DNS → Cloud Run).
 * TLS: signed by Colt internal CA — use certs/colt-internal-ca.pem for curl/Vite.
 * IAM: token audience must be CLOUD_RUN_IAM_AUDIENCE (.run.app URL), not this DNS host.
 *
 * Architecture B: the browser always talks to `/api/translation/v1` same-origin.
 * In production the GCLB URL map routes that path to THIS (aihub) backend, and
 * nginx reverse-proxies it to TRANSLATION_API_ORIGIN — IAP is not applied a second
 * time; the hub's own X-Goog-IAP-JWT-Assertion is forwarded unchanged and verified
 * by Translation's HUB_IAP_AUDIENCE fallback. See nginx/default.conf.template.
 *
 * Configuration loaded from environment variables (.env.local or .env.production).
 */

import { config } from '../config';

/** Upstream host for nginx (prod) and Vite proxy (dev). Browser always uses `/api/translation/v1`. */
export const TRANSLATION_API_ORIGIN = config.translation.apiOrigin;

/** Colt internal CA bundle (issuing + root) for nginx / Vite / curl. */
export const TRANSLATION_TLS_CA_FILE = config.tls.caFile;

/** Full upstream API base (scripts, docs — not used by browser fetch). */
export const TRANSLATION_API_BASE = config.translation.apiBase;

/** Canonical Cloud Run URL; required as token audience for invoker IAM. */
export const CLOUD_RUN_IAM_AUDIENCE = config.translation.cloudRunUrl;
