import { useState, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import { TranslationJobsProvider } from './context/TranslationJobsContext';
import Sidebar, { type ServiceEntitlements } from './components/Sidebar';
import Topbar from './components/Topbar';
import LoginModal from './components/LoginModal';
import { isHubLoginComplete } from './api/hubAuth';
import { TRANSLATION_API_BASE } from './api/translationConfig';
import { SALES_API_BASE } from './api/salesConfig';
import { ensureFreshGoogleIdToken } from './api/cloudRunAuth';
import { ensureFreshSalesGoogleIdToken } from './api/salesCloudRunAuth';

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

/**
 * Entitlement check for a service proxied same-origin through nginx
 * (Architecture B: /api/translation/*, /api/sales/* → nginx → Cloud Run,
 * carrying the hub's own inbound X-Goog-IAP-JWT-Assertion header unchanged).
 *
 * IAP is disabled on the Translation/Sales-Agent Cloud Run backends — access
 * control there is standard Cloud Run IAM (roles/run.invoker granted to this
 * UI's own service account). Every request, including this entitlement probe,
 * must therefore carry a Google-minted identity token (audience = that Cloud
 * Run service's .run.app URL) as `Authorization: Bearer <token>`, or Cloud Run
 * itself rejects it with 403 before nginx/the app ever sees it.
 *
 * Fails closed: any network error or non-200 response denies access — only an
 * explicit HTTP 200 from the backend's /auth/whoami counts as entitled.
 */
async function checkWhoami(
  url: string,
  getGoogleIdToken: () => Promise<string | null>,
): Promise<{ entitled: boolean; email: string | null }> {
  try {
    const googleIdToken = await getGoogleIdToken();
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(googleIdToken ? { Authorization: `Bearer ${googleIdToken}` } : {}),
      },
    });
    if (!res.ok) return { entitled: false, email: null };
    const data = (await res.json().catch(() => ({}))) as {
      email?: string;
      entitled?: boolean;
    };
    return { entitled: data.entitled !== false, email: data.email ?? null };
  } catch {
    return { entitled: false, email: null };
  }
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
    // Architecture B: Translation and Sales Agent are same-origin proxied through
    // nginx directly to their Cloud Run services (IAP disabled on those backends;
    // nginx forwards the hub's own X-Goog-IAP-JWT-Assertion header unchanged, and
    // each backend's HUB_IAP_AUDIENCE fallback verifies it). A plain same-origin
    // fetch is therefore sufficient — no separate per-resource IAP session, iframe
    // warmup, or cross-resource CORS handling is required.
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
      checkWhoami(`${TRANSLATION_API_BASE}/auth/whoami`, ensureFreshGoogleIdToken),
      checkWhoami(`${SALES_API_BASE}/auth/whoami`, ensureFreshSalesGoogleIdToken),
    ])

      .then(([translation, sales]) => {
        setEntitlements({
          translation: translation.entitled,
          sales: sales.entitled,
        });
        setHubVerifiedEmail(translation.email ?? sales.email ?? null);
      })
      .catch(() => {
        // Fail closed — never grant access on an unexpected error.
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
      <TranslationJobsProvider>
        <AppShell />
      </TranslationJobsProvider>
    </AuthProvider>
  );
}

export default App;
