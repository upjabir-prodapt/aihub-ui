/**
 * Centralized configuration loaded from environment variables.
 * Use .env.local for development, .env.production for builds.
 */

function getEnvVar(key: string): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

export const config = {
  translation: {
    apiOrigin: getEnvVar('VITE_TRANSLATION_API_ORIGIN'),
    apiBase: `${getEnvVar('VITE_TRANSLATION_API_ORIGIN')}/api/v1`,
    cloudRunUrl: getEnvVar('VITE_TRANSLATION_CLOUD_RUN_URL'),
  },
  sales: {
    apiOrigin: getEnvVar('VITE_SALES_API_ORIGIN'),
    apiBase: '/api/sales/v1',
    cloudRunUrl: getEnvVar('VITE_SALES_CLOUD_RUN_URL'),
  },
  gcp: {
    projectId: getEnvVar('VITE_GCP_PROJECT_ID'),
    projectNumber: getEnvVar('VITE_GCP_PROJECT_NUMBER'),
    region: getEnvVar('VITE_GCP_REGION'),
  },
  tls: {
    caFile: getEnvVar('VITE_TLS_CA_FILE'),
  },
};
