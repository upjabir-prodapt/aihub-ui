import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSelect from './LanguageSelect';
import type { Language } from '../hooks/useNaasLanguage';
import naasLogo from '../../assets/naas-logo.png';

// Persistent top bar for the unified orchestrator experience
// (NaasChatScreen.tsx) — always visible, both on the pre-chat welcome
// screen and once a conversation is under way. `activeAgent` is the same
// ADK agent name (`service_order`/`sre_monitor`/`sre_closed_loop`)
// NaasChatScreen already tracks for UnifiedLeftPanel — this just renders
// it a second way. All three pills share one highlight color when active,
// rather than each specialist's own agentVisuals.tsx color — this bar is
// just "which one is handling this" status, not a per-agent visual
// identity.
//
// Kept as the same fixed teal brand gradient the standalone app used
// (styles/naas.css) — never theme-reactive, matching how that hero
// wasn't — so LanguageSelect uses its existing `variant="on-hero"` (built
// for that exact hero) instead of its plain surface-colored default,
// which would disappear against it. No ThemeToggle here — aihub's own
// Topbar already owns the single app-wide dark/light toggle.
const NAV_AGENTS: { key: string; labelKey: string }[] = [
  { key: 'service_order', labelKey: 'navbar.agents.serviceOrder' },
  { key: 'sre_monitor', labelKey: 'navbar.agents.serviceObservability' },
  { key: 'sre_closed_loop', labelKey: 'navbar.agents.serviceReliability' },
];

interface NavbarProps {
  activeAgent: string | null;
  // Whether a conversation is currently under way (NaasChatScreen.tsx's
  // chatStarted) — the "New chat" back button only makes sense once
  // there's actually a session to close.
  chatStarted: boolean;
  // Closes the current session and returns to the welcome screen.
  onNewChat: () => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
}

export default function NaasNavbar({
  activeAgent,
  chatStarted,
  onNewChat,
  language,
  onLanguageChange,
}: NavbarProps) {
  const { t } = useTranslation();

  return (
    <header className="navbar">
      {/* Same decorative circles the standalone app's Navbar had — its own
          wrapper (not .navbar itself) carries overflow: hidden, since
          .navbar needs to stay un-clipped for LanguageSelect's dropdown
          menu (a sibling in .navbar-actions) to extend below it. */}
      <div className="navbar-decor" aria-hidden="true">
        <span className="navbar-decor-circle navbar-decor-circle--1" />
        <span className="navbar-decor-circle navbar-decor-circle--2" />
      </div>
      <div className="navbar-left">
        {chatStarted && (
          <button
            type="button"
            className="navbar-back"
            onClick={onNewChat}
            title={t('navbar.closeSession')}
          >
            <ArrowLeft size={16} />
            {t('navbar.newChat')}
          </button>
        )}
        <img src={naasLogo} alt={t('navbar.logoAlt')} className="navbar-logo" />
      </div>

      <nav className="navbar-agents" aria-label={t('navbar.activeAgent')}>
        {NAV_AGENTS.map((navAgent) => (
          <span
            key={navAgent.key}
            className={`navbar-agent-pill${navAgent.key === activeAgent ? ' is-active' : ''}`}
          >
            {t(navAgent.labelKey)}
          </span>
        ))}
      </nav>

      <div className="navbar-actions">
        <LanguageSelect variant="on-hero" language={language} onLanguageChange={onLanguageChange} />
        <Link to="/naas/admin" className="navbar-admin-link">
          {t('navbar.admin')} →
        </Link>
      </div>
    </header>
  );
}
