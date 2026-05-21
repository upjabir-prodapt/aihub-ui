import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from '../hooks/useTranslation';
import { useAuth } from '../context/AuthContext';
import { translationApi } from '../api/translationApi';
import type { JobStatusResponse } from '../types/translation';
import '../styles/translation.css';

// ─── Constants ────────────────────────────────────────────
// Language codes sent as full names per API spec (case-insensitive accepted)
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'ja', label: 'Japanese' },
];

const SOURCE_LANGUAGES = [{ code: '', label: 'Auto Detect' }, ...LANGUAGES];

// API domain values (lowercase per spec)
const DOMAINS = [
  { value: 'commercial', label: 'Commercial' },
  { value: 'legal',      label: 'Legal' },
  { value: 'finance',    label: 'Finance' },
  { value: 'hr',         label: 'HR' },
  { value: 'operations', label: 'Operations' },
];

// ─── Helpers ──────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getLangLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusColor(s: string): string {
  if (s === 'completed') return 'var(--colt-teal)';
  if (s === 'failed' || s === 'cancelled') return '#ef4444';
  return 'var(--text-muted)';
}

// ─── Sub-components ───────────────────────────────────────

const SkeletonLoader: React.FC = () => (
  <div className="output-loading">
    {[100, 85, 92, 70, 95].map((w, i) => (
      <div key={i} className="skeleton" style={{ height: 14, width: `${w}%` }} />
    ))}
    <div className="skeleton" style={{ height: 14, width: '60%' }} />
  </div>
);

// ─── Jobs History Panel ────────────────────────────────────

const JobsHistoryPanel: React.FC = () => {
  const [jobs, setJobs]       = useState<JobStatusResponse[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset]   = useState(0);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const LIMIT = 5;

  const load = useCallback(async (off: number) => {
    setLoading(true);
    try {
      const res = await translationApi.listJobs({ limit: LIMIT, offset: off });
      setJobs(res.jobs);
      setTotal(res.total);
    } catch {
      // silently ignore — history is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(0); }, [load]);

  const handleCancel = async (jobId: string) => {
    setCancelling(jobId);
    try {
      await translationApi.cancelJob(jobId, 'User cancelled from history');
      void load(offset);
    } catch {
      // ignore
    } finally {
      setCancelling(null);
    }
  };

  const handleDownload = async (jobId: string) => {
    try {
      const resp = await translationApi.getDownloadUrl(jobId);
      window.open(resp.download_url, '_blank');
    } catch {
      // ignore
    }
  };

  return (
    <div className="jobs-history-panel">
      <div className="jobs-history-header">
        <span className="jobs-history-title">Recent Jobs</span>
        <button
          className="jobs-refresh-btn"
          onClick={() => void load(offset)}
          title="Refresh"
          disabled={loading}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>

      {loading && jobs.length === 0 && (
        <div className="jobs-loading">
          <div className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />
          <div className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />
          <div className="skeleton" style={{ height: 52, borderRadius: 10 }} />
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="jobs-empty">No jobs yet</div>
      )}

      {jobs.map((job) => (
        <div key={job.job_id} className="job-row">
          <div className="job-row-left">
            <span className="job-status-dot" style={{ background: statusColor(job.status) }} />
            <div className="job-row-info">
              <span className="job-id-label">{job.job_id.substring(0, 8)}…</span>
              <span className="job-row-meta">
                {job.status.toUpperCase()}
                {job.created_at && ` · ${formatTime(job.created_at)}`}
              </span>
            </div>
          </div>
          <div className="job-row-actions">
            {job.status === 'completed' && (
              <button className="job-dl-btn" onClick={() => void handleDownload(job.job_id)} title="Download">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            )}
            {(job.status === 'queued' || job.status === 'processing') && (
              <button
                className="job-cancel-btn"
                onClick={() => void handleCancel(job.job_id)}
                disabled={cancelling === job.job_id}
                title="Cancel"
              >
                {cancelling === job.job_id ? '…' : '✕'}
              </button>
            )}
          </div>
        </div>
      ))}

      {total > LIMIT && (
        <div className="jobs-pagination">
          <button
            className="jobs-pg-btn"
            disabled={offset === 0 || loading}
            onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); void load(o); }}
          >‹ Prev</button>
          <span className="jobs-pg-info">{Math.floor(offset / LIMIT) + 1} / {Math.ceil(total / LIMIT)}</span>
          <button
            className="jobs-pg-btn"
            disabled={offset + LIMIT >= total || loading}
            onClick={() => { const o = offset + LIMIT; setOffset(o); void load(o); }}
          >Next ›</button>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────
interface TranslationPageProps {
  onRequestLogin?: () => void;
}

const TranslationPage: React.FC<TranslationPageProps> = ({ onRequestLogin }) => {
  const { isAuthenticated, user } = useAuth();
  const [file, setFile] = useState<File | null>(null);

  const [sourceLang, setSourceLang] = useState('');
  const [targetLang, setTargetLang] = useState('en');
  const [domain, setDomain]         = useState('commercial');
  const [enableDlp, setEnableDlp]   = useState(true);
  const [enableChunking, setEnableChunking] = useState(true);
  const [priority, setPriority]     = useState('standard');

  const {
    status,
    jobStatus,
    jobDetail,
    error,
    startTranslation,
    cancelJob,
    getDownloadUrl,
    reset,
  } = useTranslation();

  const [copied, setCopied]           = useState(false);
  const [downloading, setDownloading] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // ── Dropzone ──
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) setFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf'],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
  });

  const clearFile = () => setFile(null);

  // ── Translate ──
  const handleTranslate = async () => {
    if (!isAuthenticated) { onRequestLogin?.(); return; }
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    // API field names: target_language / source_language (full names per spec)
    formData.append('target_language', getLangLabel(targetLang));
    if (sourceLang) formData.append('source_language', getLangLabel(sourceLang));
    formData.append('domain', domain);
    formData.append('enable_dlp', String(enableDlp));
    formData.append('enable_chunking', String(enableChunking));
    formData.append('priority', priority);

    startTranslation(formData);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 500);
  };

  // ── Copy ──
  const handleCopy = async () => {
    const content = jobDetail?.result?.translated_document?.content;
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Download ──
  const handleDownload = async () => {
    setDownloading(true);
    try {
      // Try fresh signed URL first (preferred)
      const resp = await getDownloadUrl();
      if (resp?.download_url) {
        window.open(resp.download_url, '_blank');
        return;
      }
      // Fallback: URL from detail response
      const detailUrl = jobDetail?.result?.translated_document?.download_url;
      if (detailUrl) { window.open(detailUrl, '_blank'); return; }
      // Last resort: inline content
      const content = jobDetail?.result?.translated_document?.content;
      if (content) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = jobDetail?.result?.translated_document?.filename || `translated_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // ignore
    } finally {
      setDownloading(false);
    }
  };

  const canTranslate = !!file;
  const isLoading    = status === 'submitting' || status === 'polling';

  // ─── Auth gate ─────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="page-content">
        <div className="auth-gate">
          <div className="auth-gate-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h2 className="auth-gate-title">Authentication Required</h2>
          <p className="auth-gate-sub">Sign in with your Colt credentials to access the AI Translation Service.</p>
          <button className="auth-gate-btn" onClick={onRequestLogin} id="auth-gate-signin-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
            Sign In with Colt
          </button>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────
  return (
    <div className="page-content">
      {/* Hero */}
      <div className="hero-banner">
        <div className="hero-banner-glow" />
        <div className="hero-left">
          <div className="hero-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
              <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
            </svg>
          </div>
          <div>
            <h1 className="hero-title">AI Translation Service</h1>
            <p className="hero-subtitle">
              Enterprise translation with automated DLP and anonymization.
              Integrated with Colt's Security Policy for structure-preserving Word &amp; PDF conversion.
            </p>
          </div>
        </div>
        <div className="hero-stats">
          <div className="stat-item">
            <div className="stat-value">6</div>
            <div className="stat-label">Languages</div>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <div className="stat-value">DLP</div>
            <div className="stat-label">Secure API</div>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <div className="stat-value">PDF/Word</div>
            <div className="stat-label">Formats</div>
          </div>
        </div>
      </div>

      {/* Workspace */}
      <div className="workspace">

        {/* ── Input Panel ── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Input &amp; Configuration</h2>
          </div>

          <div className="panel-body">
            {/* File Upload */}
            {!file ? (
              <div {...getRootProps()} className={`drop-zone ${isDragActive ? 'drag-over' : ''}`}>
                <input {...getInputProps()} />
                <div className="drop-zone-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17,8 12,3 7,8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <p className="drop-zone-title">{isDragActive ? 'Drop it here!' : 'Drop your file here'}</p>
                <p className="drop-zone-sub">or <span className="drop-zone-link">browse to upload</span></p>
                <p className="drop-zone-types">Supports .docx and .pdf · Max 10 MB</p>
              </div>
            ) : (
              <div className="file-preview">
                <div className="file-preview-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                  </svg>
                </div>
                <div className="file-preview-info">
                  <div className="file-preview-name">{file.name}</div>
                  <div className="file-preview-size">{formatBytes(file.size)}</div>
                </div>
                <button className="file-remove-btn" onClick={clearFile} title="Remove file">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Language Config */}
            <div className="lang-config">
              <div className="lang-field">
                <label className="lang-label">Source Language</label>
                <select className="lang-select" value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
                  {SOURCE_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div className="lang-arrow">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/>
                </svg>
              </div>
              <div className="lang-field">
                <label className="lang-label">Target Language <span className="required">*</span></label>
                <select className="lang-select" value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Settings Grid */}
            <div className="form-grid">
              <div className="form-field">
                <label className="field-label">Domain <span className="required">*</span></label>
                <select className="field-select" value={domain} onChange={(e) => setDomain(e.target.value)}>
                  {DOMAINS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Enable DLP</label>
                <select className="field-select" value={String(enableDlp)} onChange={(e) => setEnableDlp(e.target.value === 'true')}>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Enable Chunking</label>
                <select className="field-select" value={String(enableChunking)} onChange={(e) => setEnableChunking(e.target.value === 'true')}>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Priority</label>
                <select className="field-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="standard">Standard</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            {/* Translate Button */}
            <button
              className="translate-btn"
              onClick={handleTranslate}
              disabled={!canTranslate || isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner" />
                  {status === 'submitting'
                    ? 'Submitting…'
                    : `Processing · ${jobStatus?.current_stage ?? jobStatus?.status?.toUpperCase() ?? 'QUEUED'}`}
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
                    <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
                  </svg>
                  Translate
                </>
              )}
            </button>

            {/* Cancel button during polling */}
            {status === 'polling' && (
              <button
                className="cancel-job-btn"
                onClick={() => cancelJob('User cancelled')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Cancel Job
              </button>
            )}
          </div>
        </div>

        {/* ── Output Panel ── */}
        <div className="panel" ref={resultRef}>
          <div className="panel-header">
            <h2 className="panel-title">Output</h2>
            {status === 'completed' && jobDetail?.result && (
              <div className="output-actions">
                <button
                  className={`output-action-btn ${copied ? 'copied' : ''}`}
                  onClick={handleCopy}
                  disabled={!jobDetail.result.translated_document?.content}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  className="output-action-btn"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading ? '…' : 'Download'}
                </button>
                <button className="output-action-btn" onClick={reset}>
                  New
                </button>
              </div>
            )}
          </div>

          {/* Idle */}
          {status === 'idle' && (
            <div className="output-placeholder">
              <div className="output-placeholder-icon">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
                  <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
                </svg>
              </div>
              <p className="output-placeholder-title">No translation yet</p>
              <p className="output-placeholder-sub">
                Fill in the details and click <strong>Translate</strong> to start a job.
              </p>
            </div>
          )}

          {/* Loading / Polling */}
          {isLoading && (
            <div className="polling-container">
              <SkeletonLoader />
              <div className="polling-status">
                <span className="pulse-dot" />
                <span>
                  {jobStatus?.current_stage
                    ? <>Stage: <strong>{jobStatus.current_stage}</strong></>
                    : <>Status: <strong>{jobStatus?.status?.toUpperCase() ?? 'QUEUED'}</strong></>}
                </span>
                {jobStatus?.progress != null && jobStatus.progress > 0 && (
                  <span className="job-progress">{Math.round(jobStatus.progress * 100)}%</span>
                )}
                {jobStatus?.created_at && (
                  <span className="job-time">Started: {formatTime(jobStatus.created_at)}</span>
                )}
              </div>
            </div>
          )}

          {/* Cancelled */}
          {status === 'cancelled' && (
            <div className="output-error">
              <div className="error-icon" style={{ background: 'rgba(156,163,175,0.1)', borderColor: 'rgba(156,163,175,0.3)', color: '#9ca3af' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </div>
              <p className="error-title" style={{ color: 'var(--text-secondary)' }}>Job Cancelled</p>
              <button className="retry-btn" onClick={reset}>Start New Translation</button>
            </div>
          )}

          {/* Success */}
          {status === 'completed' && jobDetail?.result && (
            <div>
              <div className="result-meta">
                <span className="meta-chip">{jobDetail.result.metadata?.source_language ?? '—'}</span>
                <span className="meta-arrow">→</span>
                <span className="meta-chip teal">{jobDetail.result.metadata?.target_language ?? '—'}</span>
                {jobDetail.result.metadata?.quality_score != null && (
                  <span className="meta-chars">Score: {jobDetail.result.metadata.quality_score.toFixed(2)}</span>
                )}
              </div>
              <div className="result-text-container">
                <p className="result-text">
                  {jobDetail.result.translated_document?.content
                    || 'Document translated successfully. Click Download to retrieve your file.'}
                </p>
              </div>
              {jobDetail.result.labels && (
                <div className="result-details">
                  <div className="detail-item">
                    <span className="detail-label">Cost</span>
                    <span className="detail-value">${jobDetail.result.labels.cost_usd.toFixed(4)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Tokens</span>
                    <span className="detail-value">{jobDetail.result.labels.token_count.toLocaleString()}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Time</span>
                    <span className="detail-value">{jobDetail.result.labels.processing_time_seconds}s</span>
                  </div>
                  {jobDetail.result.metadata?.chunks_processed != null && (
                    <div className="detail-item">
                      <span className="detail-label">Chunks</span>
                      <span className="detail-value">{jobDetail.result.metadata.chunks_processed}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {status === 'failed' && (
            <div className="output-error">
              <div className="error-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <p className="error-title">Translation Failed</p>
              <p className="error-message">{error}</p>
              <button className="retry-btn" onClick={reset}>Try Again</button>
            </div>
          )}
        </div>

      </div>

      {/* ── Jobs History ── */}
      <JobsHistoryPanel />

    </div>
  );
};

export default TranslationPage;
