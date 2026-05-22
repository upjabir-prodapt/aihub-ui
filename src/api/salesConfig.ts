/** Upstream host for nginx (prod) and Vite proxy (dev). Browser uses `/api/sales/v1`. */
export const SALES_API_ORIGIN = 'https://salesagent.aicoesandox-int.colt.net';

/** Canonical Cloud Run URL; required as metadata token audience for invoker IAM. */
export const SALES_CLOUD_RUN_IAM_AUDIENCE =
  'https://salesagent-api-service-297743845367.europe-west1.run.app';

export const SALES_API_BASE = '/api/sales/v1';
