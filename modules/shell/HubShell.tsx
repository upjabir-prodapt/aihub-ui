'use client';

import { useState, useEffect } from 'react';
import { AuthProvider } from '@/modules/auth/AuthContext';
import { useAuth } from '@/modules/auth/useAuth';
import Sidebar, { type ServiceEntitlements } from '@/modules/shell/Sidebar';
import Topbar from '@/modules/shell/Topbar';
import LoginModal from '@/modules/shell/LoginModal';
import { isHubLoginComplete } from '@/modules/auth/hubAuth';
import TranslationPage from '@/modules/translation/TranslationPage';

import SalesAgentPage from '@/modules/sales-agent/SalesAgentPage';

function AccessDenied({ serviceName }: { serviceName: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-bg-base p-8">
      <div className="flex flex-col items-center justify-center max-w-md mx-auto text-center py-12 px-8 bg-bg-surface border border-border-subtle rounded-2xl shadow-xl">
        <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-6 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
          <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-text-primary mb-2">Access Denied</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
          You do not have permission to access {serviceName}. Contact your administrator to be added to the required Entra group.
        </p>
      </div>
    </div>
  );
}

/** Shown under the hub login middleware while attribution tokens are pending. */
function AwaitingHubLogin() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-bg-base p-8" aria-busy="true">
      <div className="flex flex-col items-center justify-center max-w-md mx-auto text-center py-12 px-8 bg-bg-surface border border-border-subtle rounded-2xl shadow-xl">
        <div className="w-16 h-16 rounded-full bg-colt-teal/10 text-colt-teal flex items-center justify-center mb-6 border border-colt-teal/20 shadow-[0_0_15px_rgba(0,215,189,0.1)]">
          <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="2" x2="12" y2="6"/>
            <line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
            <line x1="2" y1="12" x2="6" y2="12"/>
            <line x1="18" y1="12" x2="22" y2="12"/>
            <line x1="6.34" y1="17.66" x2="9.17" y2="14.83"/>
            <line x1="14.83" y1="9.17" x2="17.66" y2="6.34"/>
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-text-primary mb-2">Sign in required</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  // Persist sidebar state
  useEffect(() => {
    const stored = localStorage.getItem('colt_sidebar_collapsed');
    if (stored === 'true') {
      setSidebarCollapsed(true);
    }
  }, []);

  // Auto-collapse the sidebar on smaller viewports, auto-expand back on larger ones.
  // Respects any manual toggle the user performs while the viewport stays in the same bucket.
  useEffect(() => {
    const BREAKPOINT = 1024; // px — matches Tailwind's `lg` breakpoint
    let lastBucketWasSmall = window.innerWidth < BREAKPOINT;
    if (lastBucketWasSmall) setSidebarCollapsed(true);

    const handleResize = () => {
      const isSmall = window.innerWidth < BREAKPOINT;
      if (isSmall !== lastBucketWasSmall) {
        lastBucketWasSmall = isSmall;
        setSidebarCollapsed(isSmall);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleToggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('colt_sidebar_collapsed', String(next));
      return next;
    });
  };

  // Single same-origin call to this Next.js server's own /auth/session route.
  // The server has already verified the IAP JWT (injected by GCLB before the
  // request even reaches this Cloud Run service) and derives per-service
  // entitlement from the JWT's `groups` claim — no separate whoami calls
  // against Translation/Sales are needed, and no cross-resource IAP session
  // establishment (the browser-side iframe/popup problem) is involved at all.
  useEffect(() => {
    fetch('/auth/session', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          setEntitlements({ translation: false, sales: false });
          setHubVerifiedEmail(null);
          return;
        }
        const data = await res.json() as {
          email: string;
          entitlements: { translation: boolean; sales: boolean };
        };
        setEntitlements(data.entitlements);
        setHubVerifiedEmail(data.email ?? null);
      })
      .catch(() => {
        // Fail closed — never grant access on an unexpected network error.
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
    <div className="flex h-screen overflow-hidden bg-bg-base text-text-primary font-sans">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        entitlements={entitlementsLoaded ? entitlements : undefined}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          activeTab={activeTab}
          theme={theme}
          onToggleTheme={toggleTheme}
          onToggleSidebar={handleToggleSidebar}
        />
        <div
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
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
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
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

export default function HubShell() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
