import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleTranslationMock, sendJson } from './translationMockRouter.ts';
import { handleSalesMock } from './salesMockRouter.ts';


export async function handleMockApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): Promise<void> {
  const url = req.url || '';
  const method = (req.method || 'GET').toUpperCase();
  const parsedUrl = new URL(url, 'http://localhost');
  const pathname = parsedUrl.pathname;

  // ── Auth & Metadata ────────────────────────────────────────────────────────
  if (pathname === '/api/metadata/id-token') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('mock_google_id_token_for_local_dev');
    return;
  }

  if (pathname === '/api/translation/v1/auth/whoami' || pathname === '/api/sales/v1/auth/whoami') {
    sendJson(res, 200, {
      email: 'dev@colt.net',
      business_unit: 'Technology & Operations',
      organization: 'Colt Technology Services',
    });
    return;
  }

  if (pathname === '/api/translation/v1/auth/token' || pathname === '/api/sales/v1/auth/token') {
    res.setHeader('Set-Cookie', 'colt_session=mock_session_token; Path=/; HttpOnly; SameSite=Lax');
    sendJson(res, 200, {
      access_token: 'mock_session_token',
      token_type: 'bearer',
      email: 'dev@colt.net',
      user: {
        email: 'dev@colt.net',
        business_unit: 'Technology & Operations',
        organization: 'Colt Technology Services',
      },
    });
    return;
  }

  // ── Translation Service ───────────────────────────────────────────────────
  if (pathname.startsWith('/api/translation/v1')) {
    const handled = await handleTranslationMock(pathname, method, req, res);
    if (handled) return;
  }

  // ── Sales Agent Service ───────────────────────────────────────────────────
  if (pathname.startsWith('/api/sales/v1')) {
    const handled = await handleSalesMock(pathname, method, req, res);
    if (handled) return;
  }

  next();
}
