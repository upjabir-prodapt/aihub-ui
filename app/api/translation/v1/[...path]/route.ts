import { NextRequest, NextResponse } from 'next/server';
import { getSession, acquireRefreshLease, releaseRefreshLeaseAndUpdate } from '@/server/session/sessionStore';
import { decryptTokens, encryptTokens } from '@/server/session/sessionCrypto';
import { getSecret } from '@/server/secrets/gcpSecretManager';
import { refreshAccessToken } from '@/server/entra/oidcClient';
import { env } from '@/server/config/env';

async function handleProxy(req: NextRequest, targetBaseUrl: string) {
  const sessionId = req.cookies.get('__Host-AISESSION')?.value;
  if (!sessionId) {
    return NextResponse.json({ error: 'Session required' }, { status: 401 });
  }

  try {
    const sessionResult = await getSession(sessionId);
    if (!sessionResult) {
      return NextResponse.json({ error: 'Session invalid or expired' }, { status: 401 });
    }

    const { session, actualHashedId } = sessionResult;
    let tokens = await decryptTokens(session.encryptedTokens);

    // 1. Proactive session token refresh check (approximate token refresh)
    // For simplicity, if we check and want to proactively refresh or if Entra tells us to,
    // we acquire the 10-second Firestore transaction lease to protect against stampedes.
    let refreshedToken = tokens.accessToken;
    const nowSec = Math.floor(Date.now() / 1000);

    // If session lease can be checked, or on active refresh:
    // Let's do a proactive or reactive refresh if tokens are stale (offline_access grant)
    if (tokens.refreshToken) {
      const leaseAcquired = await acquireRefreshLease(actualHashedId);
      if (leaseAcquired) {
        try {
          const clientSecret = await getSecret(env.ENTRA_CLIENT_SECRET_SECRET_NAME);
          const refreshRes = await refreshAccessToken(tokens.refreshToken, clientSecret);

          const encrypted = await encryptTokens({
            accessToken: refreshRes.access_token,
            refreshToken: refreshRes.refresh_token || tokens.refreshToken,
          });

          await releaseRefreshLeaseAndUpdate(actualHashedId, encrypted);
          refreshedToken = refreshRes.access_token;
        } catch (refreshErr) {
          console.error('BFF proactive Token Refresh failed:', refreshErr);
          // Don't crash, try with current token, let downstream handle failure or fail closed if grant was invalid
        }
      }
    }

    // 2. Resolve final target proxy URL
    const url = new URL(req.url);
    const apiPath = url.pathname.replace(/^\/api\/translation\/v1/, '/translation/v1');
    const targetUrl = new URL(`${targetBaseUrl}${apiPath}${url.search}`);

    // 3. Setup client headers safely (Fail Closed, strip client-spoofable contexts)
    const headers = new Headers();

    // Copy allow-listed headers from incoming browser request (e.g. content-type)
    const allowedHeaders = ['content-type', 'accept', 'accept-encoding', 'accept-language'];
    req.headers.forEach((value, key) => {
      if (allowedHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    // Inject decrypted OIDC credentials & validated server claims
    headers.set('Authorization', `Bearer ${refreshedToken}`);
    headers.set('x-colt-user-id', session.oid);
    headers.set('x-colt-user-department', session.department);
    // department/companyName are fetched from Microsoft Graph at sign-in time (not real
    // Entra token claims — see docs/19-department-companyname-claim-options.md in the
    // AICOE-Terraform repo), so Apigee/downstream services never see them in the forwarded
    // JWT itself; the BFF injects them here as trusted headers instead, same pattern as oid/roles.
    headers.set('x-colt-user-company', session.companyName);


    // Inject Apigee Client Key securely sourced from GCP Secret Manager
    const apigeeClientKey = await getSecret(env.APIGEE_CLIENT_KEY_SECRET_NAME);
    headers.set('x-colt-client-key', apigeeClientKey);

    // Stripped of incoming token headers to protect downstream
    headers.delete('x-serverless-authorization');
    headers.delete('x-goog-iap-jwt-assertion');

    // 4. Perform identical proxy fetch call
    const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.arrayBuffer() : null;

    const targetResponse = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body,
    });

    const resBody = await targetResponse.arrayBuffer();
    const resHeaders = new Headers();
    targetResponse.headers.forEach((value, key) => {
      resHeaders.set(key, value);
    });

    return new NextResponse(resBody, {
      status: targetResponse.status,
      statusText: targetResponse.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    console.error('Translation proxy execution failure:', err);
    return NextResponse.json({ error: 'Proxy request failed' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return handleProxy(req, env.TRANSLATION_API_ORIGIN);
}

export async function POST(req: NextRequest) {
  return handleProxy(req, env.TRANSLATION_API_ORIGIN);
}

export async function PUT(req: NextRequest) {
  return handleProxy(req, env.TRANSLATION_API_ORIGIN);
}

export async function DELETE(req: NextRequest) {
  return handleProxy(req, env.TRANSLATION_API_ORIGIN);
}
