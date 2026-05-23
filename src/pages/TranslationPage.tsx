import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { User, LogOut } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { useAuth } from '../context/AuthContext';
import '../styles/translation.css';

// ─── Constants ────────────────────────────────────────────
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'ja', label: 'Japanese' },
];

const SOURCE_LANGUAGES = LANGUAGES;


// ─── Helpers ──────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

// ─── Main Component ───────────────────────────────────────
interface TranslationPageProps {
  onRequestLogin?: () => void;
}

const TranslationPage: React.FC<TranslationPageProps> = ({ onRequestLogin }) => {
  const { isAuthenticated, user, logout } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  
  // New fields from screenshot
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('de');
  const [domain, setDomain] = useState('legal');
  const [enableDlp, setEnableDlp] = useState(true);
  const [enableChunking, setEnableChunking] = useState(true);
  const [priority, setPriority] = useState('standard');

  const { status, jobData, downloadInfo, error, startTranslation, reset } = useTranslation();
  
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // ── Dropzone ──
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) setFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'text/plain': ['.txt'], 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf']
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    noClick: false,
  });

  // ── Clear ──
  const clearFile = () => setFile(null);

  // ── Translate ──
  const handleTranslate = async () => {
    // Gate behind authentication
    if (!isAuthenticated) {
      onRequestLogin?.();
      return;
    }
    // Basic validation
    if (!file) return;

    const formData = new FormData();
    // Use the language code directly — the API accepts both codes and names
    formData.append('target_language', targetLang);
    if (sourceLang) formData.append('source_language', sourceLang);
    formData.append('domain', domain);
    formData.append('enable_dlp', String(enableDlp));
    formData.append('enable_chunking', String(enableChunking));
    formData.append('priority', priority);
    formData.append('file', file);

    startTranslation(formData);
    
    setTimeout(() => {
      if (resultRef.current) {
        resultRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 500);
  };

  // ── Copy ──
  const handleCopy = async () => {
    const translatedText = jobData?.result?.translated_document?.content;
    if (!translatedText) return;
    await navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Download ──
  // Priority: 1) signed URL from /jobs/{id}/download endpoint  2) inline URL from job result
  const handleDownload = () => {
    const signedUrl = downloadInfo?.download_url
      ?? jobData?.result?.translated_document?.download_url;
    if (signedUrl) {
      const filename =
        downloadInfo?.filename ??
        jobData?.result?.translated_document?.filename ??
        `translated_${Date.now()}.pdf`;
      const anchor = document.createElement('a');
      anchor.href = signedUrl;
      anchor.download = filename;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } else {
      // Fallback: download inline text content if present
      const translatedText = jobData?.result?.translated_document?.content;
      if (!translatedText) return;
      const blob = new Blob([translatedText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translated_${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const canTranslate = !!file;
  const isLoading = status === 'submitting' || status === 'polling';

  // ─── Render ────────────────────────────────────────────

  // If not authenticated show a prompt overlay instead of the full page
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
              Integrated with Colt's Security Policy for structure-preserving Word & PDF conversion.
            </p>
          </div>
        </div>
        <div className="hero-right">
          <div className="hero-stats">
            <div className="stat-item">
              <div className="stat-value">6</div>
              <div className="stat-label">Core Languages</div>
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
          {/* Session info + logout */}
          <div className="sales-session-bar">
            <div className="session-user">
              <User size={13} />
              <span>{user?.email}</span>
            </div>
            <button className="session-logout-btn" onClick={logout} title="Sign out" id="translation-logout-btn">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>


      {/* Workspace */}
      <div className="workspace">

        {/* ── Input Panel ── */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Input & Configuration</h2>
          </div>

          <div className="panel-body">
            {/* File Upload Mode */}
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
                <p className="drop-zone-title">
                  {isDragActive ? 'Drop it here!' : 'Drop your file here'}
                </p>
                <p className="drop-zone-sub">
                  or <span className="drop-zone-link">browse to upload</span>
                </p>
                <p className="drop-zone-types">Supports .txt, .docx and .pdf · Max 10 MB</p>

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
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Domain Field */}
            <div className="form-grid">
              <div className="form-field">
                <label className="field-label">Domain <span className="required">*</span></label>
                <select className="field-select" value={domain} onChange={(e) => setDomain(e.target.value)}>
                  <option value="commercial">Commercial</option>
                  <option value="legal">Legal</option>
                  <option value="finance">Finance</option>
                  <option value="hr">HR</option>
                  <option value="operations">Operations</option>
                </select>
              </div>
            </div>

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
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12,5 19,12 12,19"/>
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

            {/* Advanced Settings */}
            <div className="form-grid">
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
                  {status === 'submitting' ? 'Submitting...' : 'Processing (Job ID: ' + jobData?.job_id?.substring(0, 8) + '...)'}
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
          </div>
        </div>

        {/* ── Output Panel ── */}
        <div className="panel" ref={resultRef}>
          <div className="panel-header">
            <h2 className="panel-title">Output</h2>
            {status === 'completed' && (downloadInfo || jobData?.result) && (
              <div className="output-actions">
                {jobData?.result?.translated_document?.content && (
                  <button
                    className={`output-action-btn ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                )}
                <button className="output-action-btn primary icon-only" onClick={handleDownload} id="download-btn" title={downloadInfo?.filename ? `Download · ${downloadInfo.filename}` : 'Download'}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
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
                <span className="pulse-dot"></span>
                <span>Job Status: <strong>{(jobData?.status ?? 'queued').toUpperCase()}</strong></span>
                {jobData?.submitted_at && (
                  <span className="job-time">Started: {new Date(jobData.submitted_at).toLocaleTimeString()}</span>
                )}
              </div>
            </div>
          )}

          {/* Success */}
          {status === 'completed' && jobData?.result && (
            <div>
              <div className="result-meta">
                <span className="meta-chip">
                  {jobData.result.metadata.source_language}
                </span>
                <span className="meta-arrow">→</span>
                <span className="meta-chip teal">
                  {jobData.result.metadata.target_language}
                </span>

              </div>
              <div className="result-text-container">
                <p className="result-text">
                  {jobData.result.translated_document?.content || 'Document translated successfully. Use the download button to retrieve it.'}
                </p>
              </div>
              {jobData.result.labels && (
                <div className="result-details">
                  <div className="detail-item">
                    <span className="detail-label">Cost:</span>
                    <span className="detail-value">${jobData.result.labels.cost_usd.toFixed(4)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Tokens:</span>
                    <span className="detail-value">{jobData.result.labels.token_count}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Time:</span>
                    <span className="detail-value">{jobData.result.labels.processing_time_seconds}s</span>
                  </div>
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
    </div>
  );
};

export default TranslationPage;
