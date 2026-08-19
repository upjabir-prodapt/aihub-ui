/**
 * Server-to-server IAP identity token minting.
 *
 * Translation and Sales Agent are each independently IAP-protected backend
 * services (separate GCLB backend services, each with `iap.enabled: true`
 * and IAP's own service agent as the only authorized `roles/run.invoker`
 * on their Cloud Run services). Browser-issued IAP session cookies are
 * scoped per-resource and cannot be shared across them — this is what
 * caused the original CORS/iframe/popup problems.
 *
 * The fix implemented here: this Next.js server calls those backends
 * directly using its OWN Cloud Run service account's identity, minting a
 * short-lived Google-signed OIDC identity token whose `audience` is the
 * target backend's IAP OAuth client ID. This is a server-to-server call —
 * no browser navigation, no CORS, no iframe/popup involved at all.
 *
 * Prerequisite (one-time IAM grant, not code):
 *   Grant `roles/iap.httpsResourceAccessor` to this Cloud Run service's
 *   own service account (e.g. aicoedev-ui-sa@aicoedev.iam.gserviceaccount.com)
 *   on both the Translation and Sales Agent backend services:
 *
 *     gcloud iap web add-iam-policy-binding \
 *       --resource-type=backend-services --service=aicoedev-ilb-translation-be \
 *       --region=europe-west1 --project=aicoedev \
 *       --member="serviceAccount:aicoedev-ui-sa@aicoedev.iam.gserviceaccount.com" \
 *       --role="roles/iap.httpsResourceAccessor"
 *
 *   (repeat for aicoedev-ilb-salesagent-be, and for each environment/project)
 */

import { GoogleAuth, IdTokenClient } from 'google-auth-library';

const auth = new GoogleAuth();
const clientCache = new Map<string, IdTokenClient>();


/**
 * Returns a fresh, valid `Authorization: Bearer <token>` header value for
 * calling an IAP-protected resource whose IAP OAuth client ID is `audience`.
 * Tokens are cached per-audience by the underlying IdTokenClient and
 * refreshed automatically as needed.
 */
export async function getIapAuthorizationHeader(audience: string): Promise<string> {
  if (!audience) {
    throw new Error('Missing IAP audience for outbound service-to-service call');
  }

  let client = clientCache.get(audience);
  if (!client) {
    client = await auth.getIdTokenClient(audience);
    clientCache.set(audience, client);
  }

  const headers = await client.getRequestHeaders();
  const authHeader = headers['Authorization'] ?? headers['authorization'];
  if (!authHeader) {
    throw new Error(`Failed to mint IAP identity token for audience ${audience}`);
  }
  return authHeader;
}
