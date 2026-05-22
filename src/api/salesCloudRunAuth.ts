/** Cloud Run identity tokens for Sales Agent API. */

import { createCloudRunIdentity } from './cloudRunIdentity';
import { SALES_CLOUD_RUN_IAM_AUDIENCE } from './salesConfig';

const salesIdentity = createCloudRunIdentity({
  audience: SALES_CLOUD_RUN_IAM_AUDIENCE,
  googleTokenKey: 'sales_google_id_token',
  fetchedAtKey: 'sales_google_id_token_fetched_at',
  serviceName: 'Sales Agent',
});

export const {
  getStoredSalesGoogleIdToken,
  persistSalesGoogleIdToken,
  fetchSalesGoogleIdToken,
  ensureFreshSalesGoogleIdToken,
  forceRefreshSalesGoogleIdToken,
} = {
  getStoredSalesGoogleIdToken: salesIdentity.getStoredGoogleIdToken,
  persistSalesGoogleIdToken: salesIdentity.persistGoogleIdToken,
  fetchSalesGoogleIdToken: salesIdentity.fetchGoogleIdToken,
  ensureFreshSalesGoogleIdToken: salesIdentity.ensureFreshGoogleIdToken,
  forceRefreshSalesGoogleIdToken: salesIdentity.forceRefreshGoogleIdToken,
};

/** Background refresh interval while sales session is active. */
export const SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;
