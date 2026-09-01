import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

interface RequireRoleProps {
  /** Any one of these roles grants access. */
  anyOf: readonly string[];
  /** Identifies the service in the `/denied` message. */
  service?: string;
}

/**
 * Route guard for role-gated sections.
 *
 * Only a confirmed `authenticated` status is allowed through. While loading or
 * degraded the guard renders nothing, because the alternative — treating an
 * empty role list as "denied" — would bounce users to `/denied` during a
 * Firestore outage.
 */
const RequireRole: React.FC<RequireRoleProps> = ({ anyOf, service }) => {
  const { status, hasRole } = useAuth();

  if (status !== 'authenticated') return null;

  if (!hasRole(...anyOf)) {
    return <Navigate to="/denied" replace state={{ service }} />;
  }

  return <Outlet />;
};

export default RequireRole;
