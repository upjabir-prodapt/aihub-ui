import { config } from '@/shared/config';

/** Upstream host for nginx (prod) and Vite proxy (dev). Browser uses `/api/sales/v1`. */
export const SALES_API_ORIGIN = config.sales.apiOrigin;

/** Canonical Cloud Run URL; required as metadata token audience for invoker IAM. */
export const SALES_CLOUD_RUN_IAM_AUDIENCE = config.sales.cloudRunUrl;

export const SALES_API_BASE = config.sales.apiBase;
