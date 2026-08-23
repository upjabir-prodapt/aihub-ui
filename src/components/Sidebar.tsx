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
  badge?: string;
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
    id: 'contracts',
    label: 'Contract Management',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/>
      </svg>
    ),
    badge: 'Soon',
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
  {
    id: 'vertex-ai',
    label: 'Vertex AI Platform',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    ),
    badge: 'Soon',
  },
];

function resolveItemState(
  item: (typeof NAV_ITEMS)[number],
  entitlements?: ServiceEntitlements,
): { disabled: boolean; locked: boolean; title: string } {
  if (item.badge === 'Soon') {
    return { disabled: true, locked: false, title: 'Coming soon' };
  }
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

        {NAV_ITEMS.map((item) => {
          const { disabled, locked, title } = resolveItemState(item, entitlements);
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
              {!collapsed && (
                <>
                  <span className="nav-label">{item.label}</span>
                  {item.badge && <span className="nav-item-tag">{item.badge}</span>}
                  {locked && <span className="nav-item-tag">Locked</span>}
                </>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};

export default Sidebar;
