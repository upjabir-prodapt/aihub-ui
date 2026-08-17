import React, { useState, useEffect } from 'react';
import { useAuth } from '@/modules/auth/useAuth';
import { loadAttributionPrefs } from '@/modules/auth/authStorage';
import { loadSalesAttributionPrefs } from '@/modules/sales-agent/salesAgentApi';
import { type ServiceEntitlements } from '@/modules/shell/Sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Lock } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  entitlements: ServiceEntitlements;
  entitlementsLoaded: boolean;
  verifiedEmail: string | null;
  onClose?: () => void;
  /** If true the modal is blocking — clicking backdrop doesn't close it */
  blocking?: boolean;
}

const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  blocking = false,
  entitlements,
  entitlementsLoaded,
  verifiedEmail,
}) => {
  const {
    login,
    isLoading,
    error,
    clearError,
    iapEmail,
  } = useAuth();
  
  const translationPrefs = loadAttributionPrefs();
  const salesPrefs = loadSalesAttributionPrefs();
  
  const [businessUnit, setBusinessUnit] = useState(
    translationPrefs.business_unit || salesPrefs.business_unit || 'SBU',
  );
  const [organization, setOrganization] = useState(
    translationPrefs.organization || salesPrefs.organization || 'Colt',
  );

  const displayEmail = verifiedEmail ?? iapEmail;
  const canSubmit = entitlementsLoaded && (entitlements.translation || entitlements.sales);

  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !blocking && onClose) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [blocking, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(businessUnit, organization, entitlements);
  };

  const handleBackdrop = () => {
    if (!blocking && onClose) onClose();
  };

  if (!isOpen) return null;

  const serviceHint = [
    entitlements.translation ? 'Translation' : null,
    entitlements.sales ? 'Sales Agent' : null,
  ].filter(Boolean).join(' and ');

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Login"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md animate-in zoom-in-95 duration-200"
      >
        <Card className="relative overflow-hidden border-border-strong/40 shadow-2xl bg-bg-surface">
          {/* Top colored accent line */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-colt-teal via-colt-teal/50 to-transparent" />
          
          <CardHeader className="space-y-1.5 pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center justify-center w-[30px] h-[30px] shrink-0">
                <div 
                  className="w-[30px] h-[30px] bg-colt-teal" 
                  style={{ clipPath: 'polygon(0 0, 70% 0, 100% 50%, 70% 100%, 0 100%, 30% 50%)' }} 
                />
              </div>
              <div>
                <span className="text-sm font-bold text-text-primary">Colt</span>
                <span className="text-xs text-colt-teal font-semibold tracking-wider ml-1 uppercase">AI Hub</span>
              </div>
            </div>
            <CardTitle className="text-xl font-bold tracking-tight">Sign in to continue</CardTitle>
            <CardDescription className="text-xs text-text-secondary leading-relaxed">
              Your identity is verified via Entra SSO. Provide cost attribution details below.
              {canSubmit && serviceHint ? ` Signing in to ${serviceHint}.` : ''}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {displayEmail && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-signed-in-as">Signed in as</Label>
                <div className="relative">
                  <Input
                    id="auth-signed-in-as"
                    type="text"
                    value={displayEmail}
                    disabled
                    className="opacity-80 cursor-default bg-bg-elevated border-none select-all"
                  />
                  <Lock className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="auth-bu" className="flex items-center gap-1">
                  Business Unit <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="auth-bu"
                  name="business_unit"
                  type="text"
                  required
                  value={businessUnit}
                  onChange={(e) => setBusinessUnit(e.target.value)}
                  placeholder="e.g. SBU"
                  autoComplete="organization"
                  className="bg-bg-surface"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="auth-org" className="flex items-center gap-1">
                  Organization <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="auth-org"
                  name="organization"
                  type="text"
                  required
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="e.g. Colt"
                  autoComplete="organization"
                  className="bg-bg-surface"
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2.5 text-xs text-red-400 animate-in fade-in-0 duration-150">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 leading-relaxed">
                    <strong>Sign-in Error:</strong> {error}
                  </div>
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading || !canSubmit}
                className="w-full font-semibold cursor-pointer h-10 mt-2"
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Authenticating...</span>
                  </div>
                ) : (
                  <span>Continue to Services</span>
                )}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="bg-bg-elevated/40 border-t border-border-subtle p-4 flex justify-between items-center text-[10px] text-text-muted">
            <span>Secure Enterprise Session</span>
            <span>Colt CoE Identity Gate</span>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default LoginModal;
