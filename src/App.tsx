import { useState, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import Sidebar, { type ServiceEntitlements } from './components/Sidebar';
import Topbar from './components/Topbar';
import LoginModal from './components/LoginModal';
import { TRANSLATION_API_BASE } from './api/translationConfig';
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

// ── Inner shell (has access to AuthContext) ──────────────────────────────

function AppShell() {
  const [activeTab, setActiveTab] = useState('translation');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [loginOpen, setLoginOpen] = useState(false);
  const [entitlements, setEntitlements] = useState<ServiceEntitlements>({
    translation: true,
    sales: true,
  });
  const [salesVerifiedEmail, setSalesVerifiedEmail] = useState<string | null>(null);
  const [entitlementsLoaded, setEntitlementsLoaded] = useState(false);

  const { isAuthenticated } = useAuth();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    Promise.all([
      fetch(`${TRANSLATION_API_BASE}/auth/whoami`, { credentials: 'include' }).then(async (res) => ({
        ok: res.ok,
        data: res.ok ? await res.json() as { email: string } : null,
      })),
      fetch('/api/sales/v1/auth/whoami', { credentials: 'include' }).then(async (res) => ({
        ok: res.ok,
        data: res.ok ? await res.json() as { email: string } : null,
      })),
    ])
      .then(([translation, sales]) => {
        setEntitlements({
          translation: translation.ok,
          sales: sales.ok,
        });
        setSalesVerifiedEmail(sales.data?.email ?? null);
      })
      .catch(() => {
        // Keep defaults if probe fails (e.g. local dev)
      })
      .finally(() => setEntitlementsLoaded(true));
  }, []);

  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  const openLogin = () => setLoginOpen(true);
  const closeLogin = () => {
    setLoginOpen(false);
  };

  const handleTabChange = (tab: string) => {
    if (tab === 'translation' && entitlementsLoaded && !entitlements.translation) return;
    if (tab === 'sales' && entitlementsLoaded && !entitlements.sales) return;
    setActiveTab(tab);
  };

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
        <div style={{ display: activeTab === 'translation' ? 'contents' : 'none' }}>
          {entitlementsLoaded && !entitlements.translation ? (
            <AccessDenied serviceName="Translation" />
          ) : (
            <TranslationPage onRequestLogin={openLogin} />
          )}
        </div>
        <div style={{ display: activeTab === 'sales' ? 'contents' : 'none' }}>
          {entitlementsLoaded && !entitlements.sales ? (
            <AccessDenied serviceName="Sales Agent" />
          ) : (
            <SalesAgentPage verifiedEmail={salesVerifiedEmail} />
          )}
        </div>
      </div>

      <LoginModal
        isOpen={loginOpen}
        onClose={isAuthenticated ? closeLogin : undefined}
        blocking={!isAuthenticated && loginOpen}
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
