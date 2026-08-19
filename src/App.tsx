import { useState, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import Sidebar, { type ServiceEntitlements } from './components/Sidebar';
import Topbar from './components/Topbar';
import LoginModal from './components/LoginModal';
import { isHubLoginComplete } from './api/hubAuth';
import { TRANSLATION_API_BASE } from './api/translationConfig';
import { SALES_API_BASE } from './api/salesConfig';
import { probeEntitlement } from './api/iapProbe';

import TranslationPage from './pages/TranslationPage';
import SalesAgentPage from './pages/SalesAgentPage';
import './styles/layout.css';

function AccessDenied({ serviceName }: { serviceName: string }) {
  return (
    <div className="page-content">
      <div className="auth-gate">
        <div className="auth-gate-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 className="auth-gate-title">Access Denied</h2>
        <p className="auth-gate-sub">
          You do not have permission to access {serviceName}. Contact your administrator to be added to the required Entra group.
        </p>
      </div>
    </div>
  );
}

/** Shown under the hub login middleware while attribution tokens are pending. */
function AwaitingHubLogin() {
  return (
    <div className="page-content" aria-busy="true">
      <div className="auth-gate">
        <h2 className="auth-gate-title">Sign in required</h2>
        <p className="auth-gate-sub">
          Provide cost attribution once to unlock your entitled services.
        </p>
      </div>
    </div>
  );
}

// ── Inner shell (has access to AuthContext) ──────────────────────────────

function AppShell() {
  const [activeTab, setActiveTab] = useState('translation');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [entitlements, setEntitlements] = useState<ServiceEntitlements>({
    translation: false,
    sales: false,
  });
  const [hubVerifiedEmail, setHubVerifiedEmail] = useState<string | null>(null);
  const [entitlementsLoaded, setEntitlementsLoaded] = useState(false);

  const { isAuthenticated, isSalesAuthenticated } = useAuth();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    // Fail-closed entitlement probe: each backend (Translation, Sales Agent) is an
    // independently IAP-protected resource, so a per-service login round-trip may be
    // required even though the hub itself is already authenticated. probeEntitlement()
    // handles that transparently (silent iframe warmup) and NEVER grants access on
    // error/timeout — only an explicit HTTP 200 from the backend counts as entitled.
    if (import.meta.env.DEV) {
      // Local dev without IAP infra — no backend to probe against; unlock both.
      // Deferred via Promise.resolve().then() so setState doesn't run synchronously
      // within the effect body (react-hooks/set-state-in-effect).
      Promise.resolve().then(() => {
        setEntitlements({ translation: true, sales: true });
        setEntitlementsLoaded(true);
      });
      return;
    }

    Promise.all([
      probeEntitlement(`${TRANSLATION_API_BASE}/auth/whoami`),
      probeEntitlement(`${SALES_API_BASE}/auth/whoami`),
    ])
      .then(([translation, sales]) => {
        setEntitlements({
          translation: translation.entitled,
          sales: sales.entitled,
        });
        setHubVerifiedEmail(translation.email ?? sales.email ?? null);
      })
      .catch(() => {
        // Defensive: probeEntitlement() itself never rejects, but if it somehow
        // did, fail closed — never grant access on an unexpected error.
        setEntitlements({ translation: false, sales: false });
      })
      .finally(() => setEntitlementsLoaded(true));
  }, []);



  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  const handleTabChange = (tab: string) => {
    if (tab === 'translation' && entitlementsLoaded && !entitlements.translation) return;
    if (tab === 'sales' && entitlementsLoaded && !entitlements.sales) return;
    setActiveTab(tab);
  };

  const hasAnyEntitlement = entitlements.translation || entitlements.sales;
  const loginComplete = entitlementsLoaded
    && isHubLoginComplete(entitlements, isAuthenticated, isSalesAuthenticated);

  // Hub middleware: one blocking BU/Org Continue for all entitled services.
  const hubLoginRequired = entitlementsLoaded && hasAnyEntitlement && !loginComplete;

  return (
    <div className="app-layout">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        entitlements={entitlementsLoaded ? entitlements : undefined}
      />
      <div className="main-content">
        <Topbar
          activeTab={activeTab}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <div
          className="main-pane"
          style={{ display: activeTab === 'translation' ? 'flex' : 'none' }}
        >
          {entitlementsLoaded && !entitlements.translation ? (
            <AccessDenied serviceName="Translation" />
          ) : hubLoginRequired || !isAuthenticated ? (
            <AwaitingHubLogin />
          ) : (
            <TranslationPage />
          )}
        </div>
        <div
          className="main-pane"
          style={{ display: activeTab === 'sales' ? 'flex' : 'none' }}
        >
          {entitlementsLoaded && !entitlements.sales ? (
            <AccessDenied serviceName="Sales Agent" />
          ) : hubLoginRequired || !isSalesAuthenticated ? (
            <AwaitingHubLogin />
          ) : (
            <SalesAgentPage />
          )}
        </div>
      </div>

      <LoginModal
        isOpen={hubLoginRequired}
        entitlements={entitlements}
        entitlementsLoaded={entitlementsLoaded}
        verifiedEmail={hubVerifiedEmail}
        blocking
      />
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
