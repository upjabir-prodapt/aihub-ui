/** Cloud Run identity tokens for Translation API. */

import { createCloudRunIdentity } from './cloudRunIdentity';
import { CLOUD_RUN_IAM_AUDIENCE } from './translationConfig';

const translationIdentity = createCloudRunIdentity({
  audience: CLOUD_RUN_IAM_AUDIENCE,
  googleTokenKey: 'colt_google_id_token',
  fetchedAtKey: 'colt_google_id_token_fetched_at',
  serviceName: 'Translation',
});

export const {
  getStoredGoogleIdToken,
  persistGoogleIdToken,
  fetchGoogleIdToken,
  ensureFreshGoogleIdToken,
  forceRefreshGoogleIdToken,
} = translationIdentity;
