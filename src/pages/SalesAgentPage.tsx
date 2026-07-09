import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { 
  Search, 
  RefreshCw, 
  CheckCircle2,
  AlertCircle,
  FileText, 
  ShieldCheck,
  Zap,
  Globe,
  PieChart,
  ArrowRight,
  Download,
  LogOut,
  User,
  Hash,
} from 'lucide-react';
import {
  initiateResearch,
  getResearchStatus,
  getResearchResult,
  downloadResearchFile,
} from '../api/salesAgentApi';
import { useAuth } from '../context/useAuth';
import {
  forceRefreshSalesGoogleIdToken,
  SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS,
} from '../api/salesCloudRunAuth';
import '../styles/translation.css';
import '../styles/sales-agent.css';

// ── Types ──────────────────────────────────────────────────────────────────

type Status = 'IDLE' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

// ── Validation ─────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// Main Sales Agent Page
// ══════════════════════════════════════════════════════════════════════════════

interface SalesAgentPageProps {
  onRequestLogin?: () => void;
}

const SalesAgentPage: React.FC<SalesAgentPageProps> = ({ onRequestLogin }) => {
  const { isSalesAuthenticated, salesUser, logoutSales, iapEmail } = useAuth();

  // ── Research state ─────────────────────────────────────────────────────────
  const [company,    setCompany]    = useState('');
  const [accountId,  setAccountId]  = useState('');
  const [jobId,      setJobId]      = useState<string | null>(null);
  const [status,     setStatus]     = useState<Status>('IDLE');
  const [report,     setReport]     = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [lastCheck,  setLastCheck]  = useState<Date | null>(null);
  const [downloading, setDownloading] = useState(false);

  const fetchResult = useCallback(async () => {
    if (!jobId || !isSalesAuthenticated) return;
    try {
      const res = await getResearchResult(jobId);
      setReport(res.report_markdown ?? 'No report content available.');
    } catch (err) {
      console.error('Result fetch error:', err);
      setError('Failed to fetch research results.');
    }
  }, [jobId, isSalesAuthenticated]);

  const checkStatus = useCallback(async () => {
    if (!jobId || !isSalesAuthenticated) return;
    try {
      const res = await getResearchStatus(jobId);
      const newStatus = res.status as Status;
      setStatus(newStatus);
      setLastCheck(new Date());
      if (newStatus === 'COMPLETED') void fetchResult();
    } catch (err) {
      console.error('Status check error:', err);
    }
  }, [jobId, isSalesAuthenticated, fetchResult]);

  // Keep Cloud Run invoker token fresh while sales session is active
  useEffect(() => {
    if (!isSalesAuthenticated) return;

    const refresh = async () => {
      try {
        await forceRefreshSalesGoogleIdToken();
      } catch (err) {
        console.warn('Background Sales Google ID token refresh failed:', err);
      }
    };

    const intervalId = window.setInterval(refresh, SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isSalesAuthenticated]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if ((status === 'PENDING' || status === 'PROCESSING') && jobId && isSalesAuthenticated) {
      interval = setInterval(() => void checkStatus(), 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [status, jobId, isSalesAuthenticated, checkStatus]);

  const resetResearch = () => {
    setCompany('');
    setAccountId('');
    setJobId(null);
    setStatus('IDLE');
    setReport(null);
    setError(null);
    setLastCheck(null);
  };

  const handleLogout = () => {
    logoutSales();
    resetResearch();
  };

  const startResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim() || !accountId.trim() || !isSalesAuthenticated) return;

    setStatus('PENDING');
    setError(null);
    setReport(null);
    setJobId(null);

    try {
      const res = await initiateResearch(accountId.trim(), company.trim());
      setJobId(res.job_id);
      setStatus((res.status as Status) || 'PENDING');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start research.';
      setError(msg);
      setStatus('FAILED');
    }
  };

  const handleDownload = async () => {
    if (!jobId || !isSalesAuthenticated) return;
    setDownloading(true);
    try {
      await downloadResearchFile(jobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed.';
      setError(msg);
    } finally {
      setDownloading(false);
    }
  };

  if (!isSalesAuthenticated) {
    return (
      <div className="page-content">
        <div className="auth-gate">
          <div className="auth-gate-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
          </div>
          <h2 className="auth-gate-title">Sign in to continue</h2>
          <p className="auth-gate-sub">
            {iapEmail
              ? `Signed in as ${iapEmail}. Provide cost attribution to use Sales Agent.`
              : 'Provide cost attribution to use Sales Agent.'}
          </p>
          <button type="button" className="auth-gate-btn" onClick={onRequestLogin} id="sales-hub-login-btn">
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="sales-agent-container">
      {/* ── Hero Banner ─────────────────────────────────────────────────── */}
      <header className="hero-banner">
        <div className="hero-left">
          <div className="hero-icon-wrap" style={{ background: 'var(--bg-active)', border: '1px solid var(--border-teal)' }}>
            <Zap size={24} color="var(--colt-teal)" />
          </div>
          <div>
            <h2 className="hero-title">Research Intelligence Agent</h2>
            <p className="hero-subtitle">Automated company research and sales alignment powered by 10+ specialized agents.</p>
          </div>
        </div>
        <div className="hero-right">
          <div className="hero-stats">
            <div className="stat-item">
              <div className="stat-value">Gemini 2.5</div>
              <div className="stat-label">Model Engine</div>
            </div>
            <div className="stat-divider" />
            <div className="stat-item">
              <div className="stat-value">10+</div>
              <div className="stat-label">Sub-Agents</div>
            </div>
          </div>
          {/* Session info + logout */}
          <div className="sales-session-bar">
            <div className="session-user">
              <User size={13} />
              <span>{salesUser?.email}</span>
            </div>
            <button className="session-logout-btn" onClick={handleLogout} title="Sign out" id="sales-logout-btn">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* ── IDLE: Research Form ──────────────────────────────────────────── */}
      {status === 'IDLE' && (
        <div className="search-focus-wrap">
          <div className="search-hero-content">
            <div className="search-badge">AGENTIC RESEARCH ENGINE</div>
            <h1 className="search-title">Who are we researching today?</h1>
            <p className="search-sub">Enter a company name and account ID to generate a deep-dive sales alignment report.</p>
          </div>

          <form className="research-form-area" onSubmit={startResearch}>
            {/* Account ID row */}
            <div className="research-field-row">
              <div className="research-field-group">
                <label className="research-field-label" htmlFor="res-account-id">
                  <Hash size={13} /> Account ID <span className="required">*</span>
                </label>
                <input
                  id="res-account-id"
                  type="text"
                  className="research-text-input"
                  placeholder="e.g. ACC-123"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                />
              </div>
            </div>

            {/* Company search row */}
            <div className="research-search-area" style={{ maxWidth: '700px', margin: '0 auto' }}>
              <Search className="search-area-icon" size={24} />
              <input
                id="res-company-name"
                type="text"
                className="search-area-input"
                placeholder="Enter company name (e.g. Acme Corp, OpenAI)..."
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
              <button
                type="submit"
                id="res-start-btn"
                className="translate-btn"
                style={{ width: 'auto', padding: '0 32px', marginTop: 0 }}
                disabled={!company.trim() || !accountId.trim()}
              >
                Research <ArrowRight size={18} style={{ marginLeft: '8px' }} />
              </button>
            </div>
          </form>

          <div className="research-capabilities">
            <div className="cap-item"><ShieldCheck size={16} /> Compliance Audit</div>
            <div className="cap-item"><Globe size={16} /> Market Strategy</div>
            <div className="cap-item"><PieChart size={16} /> Tech Stack</div>
          </div>
        </div>
      )}

      {/* ── PENDING / PROCESSING: Status Tracker ────────────────────────── */}
      {(status === 'PENDING' || status === 'PROCESSING') && (
        <div className="status-tracker-card">
          <div className="tracker-header">
            <h3 className="tracker-title">Researching: {company}</h3>
            <div className="tracker-req-id">Job ID: {jobId} · Account: {accountId}</div>
          </div>

          <div className="steps-container">
            <div className={`step-item ${status === 'PENDING' ? 'active' : 'done'}`}>
              <div className="step-icon">
                {status === 'PENDING' ? <RefreshCw className="spin" size={16} /> : <CheckCircle2 size={16} />}
              </div>
              <div className="step-label">Initializing Agent</div>
            </div>
            <div className={`step-item ${status === 'PROCESSING' ? 'active' : ''}`}>
              <div className="step-icon">
                {status === 'PROCESSING'
                  ? <RefreshCw className="spin" size={16} />
                  : <div className="step-dot" />}
              </div>
              <div className="step-label">Parallel Data Extraction (10+ Agents)</div>
            </div>
            <div className="step-item">
              <div className="step-icon">
                <div className="step-dot" />
              </div>
              <div className="step-label">Markdown Report Compilation</div>
            </div>
          </div>

          {lastCheck && (
            <div className="tracker-footer">Last updated: {lastCheck.toLocaleTimeString()}</div>
          )}
        </div>
      )}

      {/* ── FAILED ──────────────────────────────────────────────────────── */}
      {status === 'FAILED' && (
        <div className="output-error" style={{ background: 'var(--bg-card)', borderRadius: '20px' }}>
          <div className="error-icon"><AlertCircle size={32} /></div>
          <h3 className="error-title">Research Failed</h3>
          <p className="error-message">{error}</p>
          <button onClick={resetResearch} className="retry-btn">Start New Research</button>
        </div>
      )}

      {/* ── COMPLETED: Report ────────────────────────────────────────────── */}
      {status === 'COMPLETED' && report && (
        <div className="report-view-container">
          <div className="report-toolbar">
            <div className="report-title-wrap">
              <FileText size={20} color="var(--colt-teal)" />
              <div>
                <h3>Research Report: {company}</h3>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  Job: {jobId} · Account: {accountId}
                </div>
              </div>
            </div>
            <div className="report-actions">
              <button
                id="res-download-btn"
                className="output-action-btn download-btn"
                onClick={handleDownload}
                disabled={downloading}
                title="Download research report file"
              >
                {downloading ? (
                  <><RefreshCw size={14} className="spin" /> Downloading…</>
                ) : (
                  <><Download size={16} /> Download</>
                )}
              </button>
              <button className="output-action-btn" onClick={resetResearch}>New Research</button>
            </div>
          </div>
          <div className="report-body markdown-content">
            <ReactMarkdown>{report}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* ── COMPLETED but report not yet loaded ──────────────────────────── */}
      {status === 'COMPLETED' && !report && (
        <div className="output-loading">
          <RefreshCw className="spin" size={32} color="var(--colt-teal)" />
          <p>Compiling final markdown report…</p>
        </div>
      )}
    </div>
  );
};

export default SalesAgentPage;
