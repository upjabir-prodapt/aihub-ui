import React, { useEffect, useRef, useState } from 'react';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../../features/auth/useAuth';

/**
 * Centralized user identity control, shared across every page via Topbar.
 *
 * Signing out is now a single action against a single session. It used to clear
 * the Translation and Sales sessions independently, because there were two;
 * there is one now, and `logout()` also ends the IAP and Entra sessions
 * (docs 13 §1) — clearing only the application session would let the next
 * person at that browser be signed straight back in as this user.
 *
 * Job state deliberately does NOT live here — running jobs are surfaced by the
 * Job Tracker page and each service page's Recent runs panel, which show far
 * more (progress, cancel, download) than a dropdown could.
 */
const UserMenu: React.FC = () => {
  const { user, logout } = useAuth();

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const email = user?.email ?? null;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    setSigningOut(true);
    setOpen(false);
    void logout();
  };

  if (!email) return null;

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
      >
        <span className="user-menu-avatar">
          <User size={14} />
        </span>
        <span className="user-menu-email">{email}</span>
        <ChevronDown size={14} className={`user-menu-chevron ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-header">
            <div className="user-menu-header-email">{email}</div>
            {user?.department && (
              <div className="user-menu-header-meta">{user.department}</div>
            )}
          </div>

          <button
            className="user-menu-logout"
            onClick={handleLogout}
            disabled={signingOut}
            id="user-menu-logout-btn"
          >
            <LogOut size={14} />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
