import React from 'react';
import { useAuth } from '../context/AuthContext';

const TAB_LABELS: Record<string, string> = {
  translation: 'Translation',
  contracts: 'Contract Management',
  sales: 'Sales Agent',
  'vertex-ai': 'Vertex AI Platform',
};

interface TopbarProps {
  activeTab: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const Topbar: React.FC<TopbarProps> = ({ activeTab, theme, onToggleTheme }) => {
  const { isAuthenticated, user, logout } = useAuth();

  const initials = user?.email
    ? user.email.split('@')[0].slice(0, 2).toUpperCase()
    : '??';

  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span className="breadcrumb-root">Colt AI Hub</span>
        <span className="breadcrumb-sep">›</span>
        <span className="breadcrumb-current">{TAB_LABELS[activeTab] ?? activeTab}</span>
      </div>

      <div className="topbar-right">
        {/* Theme toggle */}
        <button className="theme-toggle" onClick={onToggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>

        {/* Status pill */}
        <div className="status-pill">
          <span className="status-dot" />
          All Systems Operational
        </div>

        {/* Auth button — only shown when authenticated */}
        {isAuthenticated && user && (
          <div className="auth-user-pill" title={user.email}>
            <div className="auth-avatar">{initials}</div>
            <div className="auth-user-info">
              <span className="auth-user-email">{user.email.split('@')[0]}</span>
              <span className="auth-user-bu">{user.business_unit}</span>
            </div>
            <button
              className="auth-logout-btn"
              onClick={logout}
              title="Sign out"
              id="topbar-logout-btn"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Topbar;
