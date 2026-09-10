/**
 * Architecture B: the browser always talks to `/api/naas/v1` same-origin. In
 * production the GCLB URL map routes that path to THIS (aihub) backend, and
 * nginx reverse-proxies it to the naas-mcp agent-backend's Cloud Run URL —
 * same pattern as Translation/Sales. See nginx/default.conf.template.
 */
import { config } from '../config';

/** Same-origin base the browser calls; nginx (prod) / Vite (dev) proxy this. */
export const NAAS_API_BASE = config.naas.apiBase;

/** Canonical Cloud Run URL; required as metadata token audience for invoker IAM. */
export const NAAS_CLOUD_RUN_IAM_AUDIENCE = config.naas.cloudRunUrl;
