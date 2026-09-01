import React from 'react';
import { useLocation } from 'react-router-dom';

interface AccessDeniedProps {
  /** Overrides the service name inferred from the URL. */
  serviceName?: string;
}

const SERVICE_NAMES: Record<string, string> = {
  translation: 'Translation',
  sales: 'Sales Agent',
};

/**
 * Rendered at `/denied`. `RequireRole` navigates here with the attempted
 * service in location state so the message can name it.
 */
const AccessDenied: React.FC<AccessDeniedProps> = ({ serviceName }) => {
  const location = useLocation();
  const stateService = (location.state as { service?: string } | null)?.service;
  const name = serviceName ?? SERVICE_NAMES[stateService ?? ''] ?? 'this service';

  return (
    <div className="page-content">
      <div className="auth-gate">
        <div className="auth-gate-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="auth-gate-title">Access Denied</h2>
        <p className="auth-gate-sub">
          You do not have permission to access {name}. Contact your administrator to be
          assigned the required Entra application role.
        </p>
      </div>
    </div>
  );
};

export default AccessDenied;
