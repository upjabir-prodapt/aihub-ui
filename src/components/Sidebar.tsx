import React from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export interface ServiceEntitlements {
  translation: boolean;
  sales: boolean;
}

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  locked?: boolean;
}

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  entitlements?: ServiceEntitlements;
  collapsed?: boolean;
  /** Omit to hide the collapse control entirely. */
  onToggleCollapsed?: () => void;
}

const NAV_ITEMS: Omit<SidebarItem, 'disabled' | 'locked'>[] = [
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

function resolveItemState(
  item: (typeof NAV_ITEMS)[number],
  entitlements?: ServiceEntitlements,
): { disabled: boolean; locked: boolean; title: string } {
  if (item.id === 'translation' && entitlements && !entitlements.translation) {
    return { disabled: true, locked: true, title: 'No access — contact your administrator' };
  }
  if (item.id === 'sales' && entitlements && !entitlements.sales) {
    return { disabled: true, locked: true, title: 'No access — contact your administrator' };
  }
  return { disabled: false, locked: false, title: item.label };
}

const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  entitlements,
  collapsed = false,
  onToggleCollapsed,
}) => {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-mark">
          <div className="logo-chevron" />
        </div>
        {!collapsed && (
          <div className="logo-text-block">
            <div className="logo-company">Colt</div>
            <div className="logo-product">AI Hub</div>
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

        {NAV_ITEMS.filter((item) => !resolveItemState(item, entitlements).locked).map((item) => {
          const { disabled, title } = resolveItemState(item, entitlements);
          return (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
              onClick={() => !disabled && onTabChange(item.id)}
              aria-disabled={disabled}
              // When collapsed the label is hidden, so the tooltip carries it.
              title={collapsed ? `${item.label}${title !== item.label ? ` — ${title}` : ''}` : title}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};

export default Sidebar;
