/**
 * Centralized configuration loaded from environment variables.
 * Local: .env.development (vite dev) or .env.local overrides.
 * CI/Docker: .env.[mode] written from build args before `vite build --mode <mode>`.
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
    apiBase: '/api/translation/v1',
    cloudRunUrl: getEnvVar('VITE_TRANSLATION_CLOUD_RUN_URL'),
  },
  sales: {
    apiOrigin: getEnvVar('VITE_SALES_API_ORIGIN'),
    apiBase: '/api/sales/v1',
    cloudRunUrl: getEnvVar('VITE_SALES_CLOUD_RUN_URL'),
  },
  contracts: {
    apiBase: getEnvVar('VITE_CONTRACTS_API_BASE'),
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
