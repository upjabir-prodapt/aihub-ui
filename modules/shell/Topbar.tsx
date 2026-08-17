import React from 'react';
import { useAuth } from '@/modules/auth/useAuth';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, Building, ChevronDown, Moon, Sun } from 'lucide-react';

const TAB_LABELS: Record<string, string> = {
  translation: 'Translation',
  contracts: 'Contract Management',
  sales: 'Sales Agent',
  'vertex-ai': 'Vertex AI Platform',
};

interface TopbarProps {
  activeTab: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onToggleSidebar?: () => void;
}

const Topbar: React.FC<TopbarProps> = ({ activeTab, theme, onToggleTheme, onToggleSidebar }) => {
  const { user, iapEmail, isAuthenticated, isSalesAuthenticated, logout, logoutSales } = useAuth();

  const email = user?.email || iapEmail || 'guest@colt.net';
  const initials = email.split('@')[0].substring(0, 2).toUpperCase() || 'CT';
  const orgText = user?.organization ? `${user.business_unit} • ${user.organization}` : 'Colt internal';

  const showSignout = isAuthenticated || isSalesAuthenticated;

  return (
    <header className="h-[60px] min-h-[60px] border-b border-border-subtle bg-bg-surface flex items-center justify-between px-4 sm:px-6 z-20 shadow-sm shrink-0 font-sans">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <button
          onClick={onToggleSidebar}
          className="text-text-muted hover:text-colt-teal cursor-pointer transition-colors duration-150 text-xs font-bold uppercase tracking-wider whitespace-nowrap"
          title="Toggle sidebar"
        >
          Colt AI Hub
        </button>
        <span className="text-colt-teal font-bold shrink-0">»</span>
        <span className="font-bold text-text-primary text-sm truncate">{TAB_LABELS[activeTab] ?? activeTab}</span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Status pill */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          All Systems Operational
        </div>

        {/* Theme toggle */}
        <button 
          className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-150 cursor-pointer" 
          onClick={onToggleTheme} 
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
        </button>

        {/* User Dropdown Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="focus:outline-none cursor-pointer">
            <div className="flex items-center gap-2 hover:opacity-90 transition-opacity">
              <Avatar className="h-8 w-8 rounded-full border border-border-subtle bg-colt-teal/10 text-colt-teal font-bold flex items-center justify-center text-xs shadow-sm shrink-0">
                {initials}
              </Avatar>
              <div className="hidden md:flex flex-col text-left">
                <span className="text-xs font-semibold text-text-primary leading-tight max-w-[120px] truncate">{email.split('@')[0]}</span>
                <span className="text-[10px] text-text-muted leading-none truncate max-w-[120px]">{orgText}</span>
              </div>
              <ChevronDown className="hidden md:block w-3.5 h-3.5 text-text-muted shrink-0" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 mt-1" side="bottom" align="end">
            <DropdownMenuLabel className="font-normal flex flex-col gap-0.5">
              <span className="text-sm font-bold text-text-primary truncate">{email}</span>
              <span className="text-[10px] text-text-muted flex items-center gap-1">
                <Building className="w-3 h-3 shrink-0" /> {orgText}
              </span>
            </DropdownMenuLabel>
            {showSignout && (
              <>
                <DropdownMenuSeparator />
                {isAuthenticated && (
                  <DropdownMenuItem 
                    className="flex items-center gap-2 text-red-400 hover:text-red-300 focus:text-red-300 cursor-pointer" 
                    onClick={logout}
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>Sign out of Translation</span>
                  </DropdownMenuItem>
                )}
                {isSalesAuthenticated && (
                  <DropdownMenuItem 
                    className="flex items-center gap-2 text-red-400 hover:text-red-300 focus:text-red-300 cursor-pointer" 
                    onClick={logoutSales}
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>Sign out of Sales Agent</span>
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default Topbar;
