import React, { useState, useEffect } from 'react';
import { useAuth, loadAttributionPrefs } from '../context/AuthContext';

interface LoginModalProps {
  isOpen: boolean;
  onClose?: () => void;
  /** If true the modal is blocking — clicking backdrop doesn't close it */
  blocking?: boolean;
}

const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, blocking = false }) => {
  const { login, isLoading, error, clearError, isAuthenticated, iapEmail } = useAuth();

  const prefs = loadAttributionPrefs();
  const [businessUnit, setBusinessUnit] = useState(prefs.business_unit);
  const [organization, setOrganization] = useState(prefs.organization);

  useEffect(() => {
    if (isOpen) {
      clearError();
      const saved = loadAttributionPrefs();
      setBusinessUnit(saved.business_unit);
      setOrganization(saved.organization);
    }
  }, [isOpen, clearError]);

  useEffect(() => {
    if (isAuthenticated && isOpen && onClose) {
      onClose();
    }
  }, [isAuthenticated, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !blocking && onClose) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, blocking, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(businessUnit, organization);
  };

  const handleBackdrop = () => {
    if (!blocking && onClose) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdrop} role="dialog" aria-modal="true" aria-label="Login">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-glow" />

        <div className="modal-header">
          <div className="modal-logo-row">
            <div className="modal-logo-mark">
              <div className="logo-chevron" />
            </div>
            <div>
              <div className="modal-logo-company">Colt</div>
              <div className="modal-logo-product">AI Hub</div>
            </div>
          </div>
          {!blocking && onClose && (
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="modal-body">
          <h2 className="modal-title">Sign in to continue</h2>
          <p className="modal-subtitle">Your identity is verified via Entra SSO. Provide cost attribution details below.</p>

          {iapEmail && (
            <div className="login-field">
              <label className="login-label">Signed in as</label>
              <div className="login-input" style={{ opacity: 0.85, cursor: 'default' }} aria-readonly="true">
                {iapEmail}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <div className="login-field">
              <label className="login-label" htmlFor="auth-bu">
                Business Unit <span className="required">*</span>
              </label>
              <input
                id="auth-bu"
                type="text"
                className="login-input"
                value={businessUnit}
                onChange={(e) => setBusinessUnit(e.target.value)}
                placeholder="e.g. SBU"
              />
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="auth-org">
                Organization <span className="required">*</span>
              </label>
              <input
                id="auth-org"
                type="text"
                className="login-input"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="e.g. Colt"
              />
            </div>

            {error && (
              <div className="login-error-banner" role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-btn"
              disabled={isLoading || !iapEmail}
              id="auth-submit-btn"
            >
              {isLoading ? (
                <>
                  <span className="spinner" />
                  Signing in…
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                  Continue
                </>
              )}
            </button>
          </form>
        </div>

        <div className="modal-footer">
          <span>Identity verified via <strong>Entra ID</strong> and GCP IAP.</span>
        </div>
      </div>
    </div>
  );
};

export default LoginModal;
