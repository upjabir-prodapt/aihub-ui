/**
 * Translation API host (internal DNS → Cloud Run).
 * TLS: signed by Colt internal CA — use certs/colt-internal-ca.pem for curl/Vite.
 * IAM: token audience must be CLOUD_RUN_IAM_AUDIENCE (.run.app URL), not this DNS host.
 */
/** Upstream host for nginx (prod) and Vite proxy (dev). Browser always uses `/api/v1`. */
export const TRANSLATION_API_ORIGIN = 'https://translation.aicoesandox-int.colt.net';

/** Colt internal CA bundle (issuing + root) for nginx / Vite / curl. */
export const TRANSLATION_TLS_CA_FILE = 'certs/colt-internal-ca.pem';

/** Full upstream API base (scripts, docs — not used by browser fetch). */
export const TRANSLATION_API_BASE = `${TRANSLATION_API_ORIGIN}/api/v1`;

/** Canonical Cloud Run URL; required as token audience for invoker IAM. */
export const CLOUD_RUN_IAM_AUDIENCE =
  'https://translation-api-service-297743845367.europe-west1.run.app';
