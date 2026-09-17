import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSelect from './LanguageSelect';
import ThemeToggle from './ThemeToggle';
import naasLogo from '../assets/naas-logo.png';
import './Navbar.css';

// Persistent top bar for the unified orchestrator experience (ChatScreen.tsx)
// — always visible, both on the pre-chat welcome screen and once a
// conversation is under way. The three specialists used to be cards on the
// landing page; they're now just status labels here, since the orchestrator
// (not the user) decides which one handles a given request. `activeAgent`
// is the same ADK agent name (`service_order`/`sre_monitor`/
// `sre_closed_loop`) ChatScreen already tracks for UnifiedLeftPanel — this
// just renders it a second way. All three pills share one highlight color
// when active, rather than each specialist's own registry/agentVisuals.tsx
// color — this bar is just "which one is handling this" status, not a
// per-agent visual identity.
//
// Restored as the same fixed teal brand gradient the old Landing hero used
// (Navbar.css) — never theme-reactive, same as that hero wasn't — so
// LanguageSelect/ThemeToggle use their existing `variant="on-hero"` (built
// for that exact hero) instead of their plain surface-colored default,
// which would disappear against it.
const NAV_AGENTS: { key: string; labelKey: string }[] = [
  { key: 'service_order', labelKey: 'navbar.agents.serviceOrder' },
  { key: 'sre_monitor', labelKey: 'navbar.agents.serviceObservability' },
  { key: 'sre_closed_loop', labelKey: 'navbar.agents.serviceReliability' },
];

interface NavbarProps {
  activeAgent: string | null;
  // Whether a conversation is currently under way (ChatScreen.tsx's
  // chatStarted) — the "New chat" back button only makes sense once
  // there's actually a session to close.
  chatStarted: boolean;
  // Closes the current session and returns to the welcome screen.
  onNewChat: () => void;
}

export default function Navbar({ activeAgent, chatStarted, onNewChat }: NavbarProps) {
  const { t } = useTranslation();

  return (
    <header className="navbar">
      {/* Same decorative circles the old Landing hero had — its own wrapper
          (not .navbar itself) carries overflow: hidden, since .navbar needs
          to stay un-clipped for LanguageSelect's dropdown menu (a sibling
          in .navbar-actions) to extend below it. */}
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
        <LanguageSelect variant="on-hero" />
        <ThemeToggle variant="on-hero" />
        <Link to="/admin" className="navbar-admin-link">
          {t('navbar.admin')} →
        </Link>
      </div>
    </header>
  );
}
