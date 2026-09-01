/**
 * The single fetch wrapper every API call goes through.
 *
 * Everything is same-origin now: the BFF serves this bundle and proxies
 * `/api/*` to Apigee, so there are no base URLs, no CORS, and no tokens in the
 * browser. Identity travels in the httpOnly `__Host-AISESSION` cookie, which JS
 * cannot read and therefore cannot leak.
 *
 * Three response codes are handled centrally, and the distinction between the
 * last two is the important part:
 *
 *   401  the session is gone      -> full-page redirect to /auth/login
 *   403  entitlement or CSRF      -> surfaced to the caller as ForbiddenError
 *   503  the BFF is degraded      -> ServiceUnavailableError, retry with backoff
 *
 * Treating 503 as 401 would send every open tab to the login endpoint the
 * moment Firestore hiccups, which is exactly the redirect storm the BFF's
 * fail-closed rules exist to prevent.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const CSRF_HEADER = 'X-CSRF-Token';

let csrfToken: string | null = null;
let redirecting = false;

/** Called by AuthProvider once `GET /auth/session` succeeds. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(body: unknown) {
    super('Your session has ended.', 401, body);
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string, body: unknown) {
    super(message, 403, body);
    this.name = 'ForbiddenError';
  }
}

export class ServiceUnavailableError extends ApiError {
  readonly retryAfterSeconds: number;

  constructor(body: unknown, retryAfterSeconds: number) {
    super('The service is temporarily unavailable.', 503, body);
    this.name = 'ServiceUnavailableError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function loginUrl(returnTo: string = window.location.pathname + window.location.search): string {
  return `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
}

/** Full-page navigation, not a client route: the BFF must issue the redirect. */
export function redirectToLogin(): void {
  if (redirecting) return;
  redirecting = true;
  window.location.assign(loginUrl());
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return await response.text().catch(() => '');
  }
  return await response.json().catch(() => null);
}

function messageFrom(body: unknown, fallback: string, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === 'object') {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
    }
    for (const key of ['detail', 'message', 'reason'] as const) {
      const value = record[key];
      if (typeof value === 'string') return value;
    }
  }
  return `${fallback} (HTTP ${status})`;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | null;
  /** Skip the automatic redirect on 401. Used by the session probe itself. */
  suppressAuthRedirect?: boolean;
  /** Human-readable fallback used when the server sends no message. */
  errorMessage?: string;
}

/** Raw request: returns the `Response` so callers can stream or read blobs. */
export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const { suppressAuthRedirect, errorMessage, headers, ...init } = options;
  const method = (init.method ?? 'GET').toUpperCase();

  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has('accept')) finalHeaders.set('accept', 'application/json');
  if (MUTATING_METHODS.has(method) && csrfToken) {
    finalHeaders.set(CSRF_HEADER, csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    method,
    headers: finalHeaders,
    // Same-origin only. `include` would be wrong: it invites cross-origin use
    // of a `__Host-` cookie that can never be cross-origin anyway.
    credentials: 'same-origin',
  });

  if (response.ok) return response;

  const body = await readBody(response);

  if (response.status === 401) {
    if (!suppressAuthRedirect) redirectToLogin();
    throw new UnauthenticatedError(body);
  }

  if (response.status === 503) {
    const retryAfter = Number(response.headers.get('retry-after') ?? '5');
    throw new ServiceUnavailableError(body, Number.isFinite(retryAfter) ? retryAfter : 5);
  }

  if (response.status === 403) {
    throw new ForbiddenError(
      messageFrom(body, errorMessage ?? 'You do not have access to this resource', 403),
      body,
    );
  }

  throw new ApiError(
    messageFrom(body, errorMessage ?? 'Request failed', response.status),
    response.status,
    body,
  );
}

/** JSON request/response convenience wrapper. */
export async function apiJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiPostJson<T>(
  path: string,
  payload: unknown,
  options: RequestOptions = {},
): Promise<T> {
  return await apiJson<T>(path, {
    ...options,
    method: options.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    body: JSON.stringify(payload),
  });
}

/** Download a response body as a file, preserving the server's filename. */
export async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  const response = await apiFetch(path, { headers: { accept: '*/*' } });
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
  const filename = match ? match[1].replace(/['"]/g, '') : fallbackFilename;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
