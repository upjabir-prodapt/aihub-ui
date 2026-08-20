/**
 * Architecture B: the browser always talks to `/api/sales/v1` same-origin. In
 * production the GCLB URL map routes that path to THIS (aihub) backend, and nginx
 * reverse-proxies it to SALES_API_ORIGIN — IAP is not applied a second time; the
 * hub's own X-Goog-IAP-JWT-Assertion is forwarded unchanged and verified by
 * Sales-Agent's HUB_IAP_AUDIENCE fallback. See nginx/default.conf.template.
 */
import { config } from '../config';

/** Upstream host for nginx (prod) and Vite proxy (dev). Browser uses `/api/sales/v1`. */
export const SALES_API_ORIGIN = config.sales.apiOrigin;


/** Canonical Cloud Run URL; required as metadata token audience for invoker IAM. */
export const SALES_CLOUD_RUN_IAM_AUDIENCE = config.sales.cloudRunUrl;

export const SALES_API_BASE = config.sales.apiBase;
