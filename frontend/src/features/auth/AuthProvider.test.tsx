import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';
import { getCsrfToken, setCsrfToken } from '../../shared/api/client';

/**
 * Decision D12 keeps Vitest to the three things the BFF cannot verify for us:
 * that a 401 becomes a redirect, that a 503 does *not*, and that role gating
 * renders `/denied`.
 *
 * The 401-vs-503 pair is the important one. Conflating them puts every open tab
 * into a login loop the moment Firestore hiccups, which is precisely the
 * failure the BFF's fail-closed rules exist to avoid — and it would be invisible
 * until an actual outage.
 */

const SESSION_PAYLOAD = {
  email: 'person@colt.net',
  name: 'A Person',
  department: 'AI CoE',
  companyName: 'Colt Technology Services',
  roles: ['Translation.User'],
  csrfToken: 'csrf-token-value',
  absoluteExpiresAt: '2030-01-01T00:00:00Z',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const Probe: React.FC = () => {
  const { status, user, error } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="email">{user?.email ?? ''}</span>
      <span data-testid="error">{error ?? ''}</span>
    </div>
  );
};

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setCsrfToken(null);
  assign = vi.fn();
  // jsdom's location is not assignable; stub the whole object.
  vi.stubGlobal('location', {
    assign,
    pathname: '/translation',
    search: '?x=1',
    href: 'https://aihub.test/translation?x=1',
  });
});

describe('AuthProvider', () => {
  it('publishes the session and the CSRF token on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SESSION_PAYLOAD)));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('email')).toHaveTextContent('person@colt.net');
    // The client must hold the token, or every mutating request 403s.
    expect(getCsrfToken()).toBe('csrf-token-value');
  });

  it('redirects to /auth/login on 401, preserving the current path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'unauthenticated' }, { status: 401 }),
      ),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(
      '/auth/login?return_to=%2Ftranslation%3Fx%3D1',
    );
  });

  it('does NOT redirect on 503 — it retries instead', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'retry-after': '1' },
        }),
      )
      .mockResolvedValue(jsonResponse(SESSION_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await vi.waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unavailable'),
    );
    // The critical assertion: a degraded BFF must never look like a sign-out.
    expect(assign).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    );
    expect(assign).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('treats a network failure like a 503, not a sign-out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));
    expect(assign).not.toHaveBeenCalled();
  });
});
