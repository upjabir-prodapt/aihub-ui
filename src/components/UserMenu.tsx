import React, { useEffect, useRef, useState } from 'react';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/useAuth';

/**
 * Centralized user identity control, shared across every page via Topbar.
 *
 * Job state deliberately does NOT live here — running jobs are surfaced by
 * the Job Tracker page and by each service page's Recent runs panel, which
 * show far more (progress, cancel, download) than a dropdown list could.
 */
const UserMenu: React.FC = () => {
  const { user, salesUser, isAuthenticated, isSalesAuthenticated, logout, logoutSales } = useAuth();

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const email = user?.email ?? salesUser?.email ?? null;

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
    if (isAuthenticated) logout();
    if (isSalesAuthenticated) logoutSales();
    setOpen(false);
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
          </div>

          <button className="user-menu-logout" onClick={handleLogout} id="user-menu-logout-btn">
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
