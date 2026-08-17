export const env = {
  // Entra ID
  ENTRA_TENANT_ID: process.env.ENTRA_TENANT_ID || 'f820f6ca-864c-41c0-b2aa-49527f91cc4a',
  ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID || 'f82163b4-4b5f-4ce9-86bc-5bb5d2f6280b',
  ENTRA_REDIRECT_URI: process.env.ENTRA_REDIRECT_URI || 'http://localhost:8080/auth/callback',
  ENTRA_CLIENT_SECRET_SECRET_NAME: process.env.ENTRA_CLIENT_SECRET_SECRET_NAME || 'entra-bff-client-secret',

  // Google Cloud
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || 'gclt-aicoe-dev-aihub-ui',
  GCP_PROJECT_NUMBER: process.env.GCP_PROJECT_NUMBER || '482057193026',
  GCP_KMS_KEY_RING: process.env.GCP_KMS_KEY_RING || 'aihub-ew3',
  GCP_KMS_KEY_NAME: process.env.GCP_KMS_KEY_NAME || 'session',
  GCP_KMS_LOCATION: process.env.GCP_KMS_LOCATION || 'europe-west3',

  // Secret Names
  APIGEE_CLIENT_KEY_SECRET_NAME: process.env.APIGEE_CLIENT_KEY_SECRET_NAME || 'apigee-bff-client-key',

  // Apigee Targets
  TRANSLATION_API_ORIGIN: process.env.TRANSLATION_API_ORIGIN || 'https://apigee-dev.colt.net',
  SALES_API_ORIGIN: process.env.SALES_API_ORIGIN || 'https://apigee-dev.colt.net',

  // Session Timeouts (minutes)
  SESSION_IDLE_TIMEOUT_MINUTES: 60,
  SESSION_ABSOLUTE_TIMEOUT_HOURS: 8,
};
