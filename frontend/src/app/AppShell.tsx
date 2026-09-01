import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../shared/ui/Sidebar';
import Topbar from '../shared/ui/Topbar';
import { useAuth, useEntitlements } from '../features/auth/useAuth';

const SIDEBAR_COLLAPSED_KEY = 'colt_sidebar_collapsed';

function readStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    // localStorage unavailable (private mode / quota) — default to expanded.
    return false;
  }
}

/** Blocking state while the initial `/auth/session` probe is in flight. */
const SessionLoading: React.FC = () => (
  <div className="app-boot" aria-busy="true">
    <div className="auth-gate">
      <h2 className="auth-gate-title">Signing you in…</h2>
      <p className="auth-gate-sub">Establishing your Colt AI Hub session.</p>
    </div>
  </div>
);

/**
 * Shown on 503 from the BFF. Deliberately *not* a sign-in prompt: the session
 * may well be fine and the store is simply unreachable.
 */
const SessionUnavailable: React.FC<{ message: string | null; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="app-boot" role="alert">
    <div className="auth-gate">
      <h2 className="auth-gate-title">Temporarily unavailable</h2>
      <p className="auth-gate-sub">
        {message ?? 'The AI Hub could not be reached. Retrying automatically.'}
      </p>
      <button type="button" className="auth-gate-retry" onClick={onRetry}>
        Retry now
      </button>
    </div>
  </div>
);

const ROUTE_TABS: Array<{ prefix: string; tab: string }> = [
  { prefix: '/tracker', tab: 'tracker' },
  { prefix: '/translation', tab: 'translation' },
  { prefix: '/sales', tab: 'sales' },
];

function tabForPath(pathname: string): string {
  return ROUTE_TABS.find((entry) => pathname.startsWith(entry.prefix))?.tab ?? 'hub';
}

const AppShell: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, error, refresh } = useAuth();
  const entitlements = useEntitlements();

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
    [],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Non-fatal — the preference just won't survive a reload.
      }
      return next;
    });
  }, []);

  const handleTabChange = useCallback(
    (tab: string) => {
      navigate(tab === 'hub' ? '/' : `/${tab}`);
    },
    [navigate],
  );

  if (status === 'loading') return <SessionLoading />;
  if (status === 'unavailable') {
    return <SessionUnavailable message={error} onRetry={() => void refresh()} />;
  }

  const activeTab = tabForPath(location.pathname);

  return (
    <div className="app-layout">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        entitlements={entitlements}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
      />
      <div className="main-content">
        <Topbar
          activeTab={activeTab}
          theme={theme}
          onToggleTheme={toggleTheme}
          onNavigateHome={() => navigate('/')}
        />
        {/*
          One pane, one route. The old shell rendered every page at once and
          hid the inactive ones with `display: none` to preserve their state;
          job state now lives in providers above the router instead (see
          app/providers.tsx), so a single outlet is enough.
        */}
        <div className="main-pane">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default AppShell;
