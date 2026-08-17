/**
 * Centralized configuration loaded from environment variables.
 * Safe for both Server (process.env) and Client (process.env.NEXT_PUBLIC_*) environments.
 */

function getEnvVar(key: string): string {
  // Try to load from process.env (Next.js server-side or public environment)
  let value = process.env[key] || process.env[`NEXT_PUBLIC_${key}`];

  if (!value) {
    try {
      // Try to load from import.meta.env (Vite compatibility)
      value = (import.meta.env as any)[key];
    } catch {
      // Ignore if import.meta.env is not available
    }
  }

  // Return resolved value or a safe default placeholder instead of throwing a hard runtime crash
  if (!value) {
    if (key.includes('ORIGIN') || key.includes('URL') || key.includes('BASE')) {
      return 'http://localhost:8080';
    }
    return 'development-placeholder';
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
