import { NextRequest, NextResponse } from 'next/server';
import { verifyIapRequest, hasGroup, IapAuthError } from '@/server/iap/verify';
import { getIapAuthorizationHeader } from '@/server/iap/serviceAccountToken';
import { env } from '@/server/config/env';

const ALLOWED_FORWARD_HEADERS = ['content-type', 'accept', 'accept-encoding', 'accept-language'];

/**
 * Proxies /api/translation/v1/* to the Translation Cloud Run backend.
 *
 * The browser's IAP session (for the `aihub` resource) is what authenticates
 * the request as far as this endpoint. From here on, THIS SERVER talks to
 * Translation directly using its own Cloud Run service account's identity —
 * a server-to-server call authenticated via a Google-minted IAP identity
 * token (audience = Translation's own IAP OAuth client ID), not the
 * browser's cookie. See server/iap/serviceAccountToken.ts for why.
 */
async function handleProxy(req: NextRequest) {
  let identity;
  try {
    identity = await verifyIapRequest(req.headers, [env.HUB_IAP_AUDIENCE]);
  } catch (err) {
    const status = err instanceof IapAuthError ? err.status : 401;
    return NextResponse.json({ error: 'Not authenticated' }, { status });
  }

  if (!hasGroup(identity, env.TRANSLATION_REQUIRED_GROUP)) {
    return NextResponse.json(
      { error: 'You do not have access to Translation. Contact your administrator.' },
      { status: 403 },
    );
  }

  try {
    const url = new URL(req.url);
    const apiPath = url.pathname.replace(/^\/api\/translation\/v1/, '/api/v1');
    const targetUrl = new URL(`${env.TRANSLATION_API_ORIGIN}${apiPath}${url.search}`);

    const headers = new Headers();
    req.headers.forEach((value, key) => {
      if (ALLOWED_FORWARD_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    // Server-to-server IAP identity token — this is what Translation's
    // iap_auth.py verifies via X-Goog-IAP-JWT-Assertion in production; when
    // called this way (server-to-server through the IAP-protected LB) IAP
    // itself injects that header downstream once this Authorization bearer
    // token is accepted, so we don't set it directly here.
    headers.set('Authorization', await getIapAuthorizationHeader(env.TRANSLATION_IAP_AUDIENCE));

    // Trusted, server-verified identity — analogous to what IAP would inject
    // directly for a browser-authenticated request.
    headers.set('x-dev-iap-user-email', identity.email);
    headers.set('x-dev-iap-user-groups', identity.groups.join(','));

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
  return handleProxy(req);
}

export async function POST(req: NextRequest) {
  return handleProxy(req);
}

export async function PUT(req: NextRequest) {
  return handleProxy(req);
}

export async function DELETE(req: NextRequest) {
  return handleProxy(req);
}
