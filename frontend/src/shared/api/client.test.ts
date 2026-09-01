import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  CSRF_HEADER,
  ForbiddenError,
  ServiceUnavailableError,
  UnauthenticatedError,
  apiFetch,
  apiJson,
  apiPostJson,
  setCsrfToken,
} from './client';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function lastRequestInit(mock: ReturnType<typeof vi.fn>): RequestInit {
  return mock.mock.calls[0][1] as RequestInit;
}

beforeEach(() => {
  setCsrfToken(null);
  vi.stubGlobal('location', { assign: vi.fn(), pathname: '/', search: '' });
});

describe('apiFetch', () => {
  it('sends same-origin credentials, never include', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/translation/v1/jobs');

    // `include` would invite cross-origin use of a cookie that, being
    // `__Host-` prefixed, can never be cross-origin anyway.
    expect(lastRequestInit(fetchMock).credentials).toBe('same-origin');
  });

  it('attaches the CSRF header on mutating verbs only', async () => {
    setCsrfToken('token-123');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/translation/v1/jobs');
    const getHeaders = lastRequestInit(fetchMock).headers as Headers;
    expect(getHeaders.get(CSRF_HEADER)).toBeNull();

    fetchMock.mockClear();
    await apiPostJson('/api/translation/v1/reviews/x', { rating: 5 });
    const postHeaders = lastRequestInit(fetchMock).headers as Headers;
    expect(postHeaders.get(CSRF_HEADER)).toBe('token-123');
  });

  it('does not send a CSRF header before the session probe has run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await apiPostJson('/api/translation/v1/reviews/x', { rating: 5 });

    const headers = lastRequestInit(fetchMock).headers as Headers;
    expect(headers.get(CSRF_HEADER)).toBeNull();
  });
});

describe('status handling', () => {
  it('401 throws UnauthenticatedError and redirects by default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    await expect(apiJson('/api/translation/v1/jobs')).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(window.location.assign).toHaveBeenCalled();
  });

  it('401 does not redirect when suppressed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    await expect(
      apiJson('/auth/session', { suppressAuthRedirect: true }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('503 throws ServiceUnavailableError with Retry-After and never redirects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({}, 503, { 'retry-after': '12' })),
    );

    const error = await apiJson('/api/translation/v1/jobs').catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ServiceUnavailableError).retryAfterSeconds).toBe(12);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('403 throws ForbiddenError and never redirects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'forbidden', requiredAnyOf: ['Translation.User'] }, 403),
      ),
    );

    await expect(apiJson('/api/translation/v1/jobs')).rejects.toBeInstanceOf(ForbiddenError);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('surfaces the server message from the mock upstream error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { message: 'Job nope not found' } }, 404),
      ),
    );

    const error = (await apiJson('/api/translation/v1/translate/nope').catch(
      (e) => e,
    )) as ApiError;

    expect(error.status).toBe(404);
    expect(error.message).toBe('Job nope not found');
  });
});
