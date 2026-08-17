import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const NAV_ITEMS: Omit<SidebarItem, 'disabled' | 'locked'>[] = [
  {
    id: 'translation',
    label: 'Translation',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
        <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
      </svg>
    ),
  },
  {
    id: 'contracts',
    label: 'Contract Management',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/>
      </svg>
    ),
    badge: 'Soon',
  },
  {
    id: 'sales',
    label: 'Sales Agent',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    id: 'vertex-ai',
    label: 'Vertex AI Platform',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  isCollapsed = false,
  onToggleCollapse,
}) => {
  return (
    <TooltipProvider delayDuration={0}>
      <aside 
        className={`h-screen bg-bg-surface border-r border-border-subtle flex flex-col relative z-10 shadow-lg transition-[width] duration-200 ${
          isCollapsed ? 'w-16 min-w-[64px]' : 'w-64 min-w-[256px]'
        }`}
      >
        {/* Sidebar top gradient line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-colt-teal to-transparent" />

        <div className="p-4 border-b border-border-subtle flex items-center justify-between gap-3 h-[60px] min-h-[60px]">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex items-center justify-center w-[30px] h-[30px] shrink-0">
              <div 
                className="w-[30px] h-[30px] bg-colt-teal" 
                style={{ clipPath: 'polygon(0 0, 70% 0, 100% 50%, 70% 100%, 0 100%, 30% 50%)' }} 
              />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col gap-0.5 animate-in fade-in-0 duration-150">
                <div className="text-sm font-bold text-text-primary tracking-tight leading-none">Colt</div>
                <div className="text-[10px] font-semibold text-colt-teal tracking-widest uppercase leading-none">AI Hub</div>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            className="text-text-secondary hover:text-text-primary h-8 w-8 cursor-pointer shrink-0"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>

        <nav className="flex-1 p-2.5 overflow-y-auto flex flex-col gap-1.5">
          {!isCollapsed && (
            <div className="text-[10px] font-bold tracking-wider uppercase text-text-muted p-[6px_10px_10px] animate-in fade-in-0 duration-150">
              Services
            </div>
          )}

          {NAV_ITEMS.map((item) => {
            const { disabled, locked, title } = resolveItemState(item, entitlements);
            const isActive = activeTab === item.id;
            
            const buttonContent = (
              <button
                className={`group relative flex items-center w-full p-2.5 rounded-xl text-left text-sm font-medium transition-all duration-200 border ${
                  isActive 
                    ? 'bg-gradient-to-r from-colt-teal/15 to-colt-teal/5 text-colt-teal border-colt-teal/25 shadow-[0_2px_12px_rgba(0,215,189,0.12)]' 
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border-transparent hover:border-border-subtle hover:shadow-sm'
                } ${disabled ? 'opacity-45 cursor-not-allowed hover:bg-transparent hover:border-transparent hover:shadow-none' : 'cursor-pointer'} ${
                  isCollapsed ? 'justify-center px-0' : 'gap-3'
                }`}
                onClick={() => !disabled && onTabChange(item.id)}
                disabled={disabled}
                title={isCollapsed ? undefined : title}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-colt-teal" />
                )}
                <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all duration-200 ${
                  isActive
                    ? 'bg-colt-teal/15 text-colt-teal'
                    : 'bg-bg-elevated text-text-secondary group-hover:bg-bg-active group-hover:text-text-primary'
                }`}>
                  {item.icon}
                </span>
                {!isCollapsed && (
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap animate-in fade-in-0 duration-150">
                    {item.label}
                  </span>
                )}
                {!isCollapsed && item.badge && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-muted tracking-wide shrink-0">
                    {item.badge}
                  </span>
                )}
                {!isCollapsed && locked && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/10 shrink-0">
                    Locked
                  </span>
                )}
              </button>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    {buttonContent}
                  </TooltipTrigger>
                  <TooltipContent side="right" className="flex items-center gap-2">
                    <span>{item.label}</span>
                    {item.badge && <span className="text-[9px] font-bold opacity-70">({item.badge})</span>}
                    {locked && <span className="text-[9px] font-bold text-red-400">(Locked)</span>}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return <React.Fragment key={item.id}>{buttonContent}</React.Fragment>;
          })}
        </nav>

        {!isCollapsed && (
          <div className="p-3 border-t border-border-subtle mt-auto text-center animate-in fade-in-0 duration-150">
            <div className="text-[9px] text-text-muted">AI Hub BFF · v1.0.0 · europe-west3</div>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
};

export default Sidebar;
