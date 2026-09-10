/** Cloud Run identity tokens for the NaaS agent-backend. */

import { createCloudRunIdentity } from './cloudRunIdentity';
import { NAAS_CLOUD_RUN_IAM_AUDIENCE } from './naasConfig';

const naasIdentity = createCloudRunIdentity({
  audience: NAAS_CLOUD_RUN_IAM_AUDIENCE,
  googleTokenKey: 'naas_google_id_token',
  fetchedAtKey: 'naas_google_id_token_fetched_at',
  serviceName: 'NaaS Agent Backend',
});

export const {
  getStoredGoogleIdToken: getStoredNaasGoogleIdToken,
  persistGoogleIdToken: persistNaasGoogleIdToken,
  fetchGoogleIdToken: fetchNaasGoogleIdToken,
  ensureFreshGoogleIdToken: ensureFreshNaasGoogleIdToken,
  forceRefreshGoogleIdToken: forceRefreshNaasGoogleIdToken,
} = naasIdentity;

/** Background refresh interval while a NaaS session is active. */
export const NAAS_GOOGLE_TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;
