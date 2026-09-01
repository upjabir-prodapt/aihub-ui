import React, { useMemo } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export interface ServiceEntitlements {
  translation: boolean;
  sales: boolean;
}

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  entitlements?: ServiceEntitlements;
  collapsed?: boolean;
  /** Omit to hide the collapse control entirely. */
  onToggleCollapsed?: () => void;
}

/* Official Colt vector wordmark (currentColor fill for theme flexibility) */
const ColtLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 305.4 120" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-label="Colt">
    <g>
      <path d="M74.62,83.43c-3.37,7.63-11.19,15.83-25,15.87-15.7,0-27.32-11.9-27.32-28.5,0-8.11,2.92-15.63,7.65-20.57,5.36-5.35,11.62-8.15,19.72-7.93,12.1-.05,20.97,6.83,24.98,16.6l18.65-10.68c-8.24-16.37-25.19-26.62-44.44-26.62C21.05,21.6,0,43.46,0,70.72s20.34,49.28,49.58,49.28c19.76,0,35.66-10.88,43.67-26.15l-18.22-10.42h-.41Z"/>
      <path d="M150.39,21.72c-32.27,0-49.63,25.19-49.63,48.91v.17c0,23.93,17.36,49.08,49.63,49.08s49.63-25.15,49.63-49.08-17.35-49.08-49.63-49.08ZM150.39,99.01c-15.14,0-27.44-12.04-27.44-28.21v-.17c0-16.34,12.3-28.37,27.44-28.37s27.45,12.04,27.45,28.37-12.28,28.38-27.45,28.38Z"/>
      <path d="M242.18,99.73s-6.42.06-6.61-5.66V0h-22.19v93.79s-1.71,23.24,20.29,23.24v.02h17.71v-17.32h-9.21Z"/>
      <path d="M292.59,99.73s-6.43.06-6.61-5.66v-50.05h17.82v-17.33h-17.82V0h-22.18v93.79s-1.32,23.3,20.27,23.24v.02h21.32v-17.32h-12.8Z"/>
    </g>
  </svg>
);

/* Colt Edge chevron — shown as compact mark when sidebar is collapsed */
const ColtEdge: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <polygon points="6,2 22,16 6,30 14,16" fill="#00D7BD"/>
  </svg>
);

const NAV_ITEMS: SidebarItem[] = [
  {
    id: 'hub',
    label: 'Colt AI Hub',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
    ),
  },
  {
    id: 'tracker',
    label: 'Job Tracker',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
    ),
  },
  {
    id: 'translation',
    label: 'Translation',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
        <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
      </svg>
    ),
  },
  {
    id: 'sales',
    label: 'Sales Agent',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
];

const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  entitlements,
  collapsed = false,
  onToggleCollapsed,
}) => {
  const visibleNavItems = useMemo(() => {
    return NAV_ITEMS.filter((item) => {
      if (item.id === 'translation' && entitlements && !entitlements.translation) return false;
      if (item.id === 'sales' && entitlements && !entitlements.sales) return false;
      return true;
    });
  }, [entitlements]);

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-logo">
        {collapsed ? (
          <ColtEdge className="logo-edge-icon" />
        ) : (
          <div className="logo-brand-block">
            <ColtLogo className="logo-wordmark" />
            <span className="logo-product-badge">AI HUB</span>
          </div>
        )}
        {onToggleCollapsed && (
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {!collapsed && <div className="nav-section-label">Services</div>}

        {visibleNavItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => onTabChange(item.id)}
            title={collapsed ? item.label : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
