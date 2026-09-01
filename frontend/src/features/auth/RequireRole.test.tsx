import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RequireRole from './RequireRole';
import AccessDenied from './AccessDenied';
import { AuthContext } from './authContextValue';
import type { AuthState, AuthStatus, SessionUser } from './authTypes';
import { ROLE_TRANSLATION } from './authTypes';

function stubAuth(status: AuthStatus, roles: string[]): AuthState {
  const user: SessionUser | null =
    status === 'authenticated'
      ? {
          email: 'person@colt.net',
          name: 'A Person',
          department: null,
          companyName: null,
          roles,
          csrfToken: 'csrf',
          absoluteExpiresAt: '2030-01-01T00:00:00Z',
        }
      : null;

  return {
    status,
    user,
    error: null,
    roles,
    hasRole: (...wanted: string[]) => wanted.some((r) => roles.includes(r)),
    refresh: async () => {},
    logout: async () => {},
  };
}

function renderAt(status: AuthStatus, roles: string[]) {
  return render(
    <AuthContext.Provider value={stubAuth(status, roles)}>
      <MemoryRouter initialEntries={['/translation']}>
        <Routes>
          <Route element={<RequireRole anyOf={ROLE_TRANSLATION} service="translation" />}>
            <Route path="/translation" element={<div>Translation workspace</div>} />
          </Route>
          <Route path="/denied" element={<AccessDenied />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('RequireRole', () => {
  it('renders the route when the user holds the role', () => {
    renderAt('authenticated', ['Translation.User']);
    expect(screen.getByText('Translation workspace')).toBeInTheDocument();
  });

  it('accepts Platform.Admin as an alternative', () => {
    renderAt('authenticated', ['Platform.Admin']);
    expect(screen.getByText('Translation workspace')).toBeInTheDocument();
  });

  it('redirects to /denied when the role is missing, naming the service', () => {
    renderAt('authenticated', ['SalesAgent.User']);
    expect(screen.queryByText('Translation workspace')).not.toBeInTheDocument();
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText(/permission to access Translation/)).toBeInTheDocument();
  });

  it('renders nothing while the session is still loading', () => {
    // Treating an empty role list as "denied" here would bounce users to
    // /denied on every cold load before the probe resolves.
    renderAt('loading', []);
    expect(screen.queryByText('Translation workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  it('renders nothing while the BFF is degraded', () => {
    // Same reasoning: a 503 is not evidence that entitlements were revoked.
    renderAt('unavailable', []);
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });
});
