import { NextRequest, NextResponse } from 'next/server';
import { verifyIapRequest, hasGroup, IapAuthError } from '@/server/iap/verify';
import { getIapAuthorizationHeader } from '@/server/iap/serviceAccountToken';
import { env } from '@/server/config/env';

const ALLOWED_FORWARD_HEADERS = ['content-type', 'accept', 'accept-encoding', 'accept-language'];

/**
 * Proxies /api/sales/v1/* to the Sales Agent Cloud Run backend.
 * See app/api/translation/v1/[...path]/route.ts for the full rationale —
 * this is the same server-to-server IAP identity token pattern.
 */
async function handleProxy(req: NextRequest) {
  let identity;
  try {
    identity = await verifyIapRequest(req.headers, [env.HUB_IAP_AUDIENCE]);
  } catch (err) {
    const status = err instanceof IapAuthError ? err.status : 401;
    return NextResponse.json({ error: 'Not authenticated' }, { status });
  }

  if (!hasGroup(identity, env.SALES_REQUIRED_GROUP)) {
    return NextResponse.json(
      { error: 'You do not have access to Sales Agent. Contact your administrator.' },
      { status: 403 },
    );
  }

  try {
    const url = new URL(req.url);
    const apiPath = url.pathname.replace(/^\/api\/sales\/v1/, '/api/v1');
    const targetUrl = new URL(`${env.SALES_API_ORIGIN}${apiPath}${url.search}`);

    const headers = new Headers();
    req.headers.forEach((value, key) => {
      if (ALLOWED_FORWARD_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    headers.set('Authorization', await getIapAuthorizationHeader(env.SALES_IAP_AUDIENCE));
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
    console.error('Sales proxy execution failure:', err);
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
