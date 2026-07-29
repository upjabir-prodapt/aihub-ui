import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { User, LogOut } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { useAuth } from '../context/useAuth';
import ReviewModal from '../components/ReviewModal';
import type { JobStatusResponse, TranslationResult } from '../types/translation';
import '../styles/translation.css';

// ΓöÇΓöÇΓöÇ Constants ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const LANGUAGES = [
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'de', label: 'German', flag: '🇩🇪' },
  { code: 'it', label: 'Italian', flag: '🇮🇹' },
  { code: 'fr', label: 'French', flag: '🇫🇷' },
  { code: 'es', label: 'Spanish', flag: '🇪🇸' },
  { code: 'ja', label: 'Japanese', flag: '🇯🇵' },
];

const SOURCE_LANGUAGES = LANGUAGES;

const langLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();


// ΓöÇΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Human-readable duration from a number of seconds.
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

// Translation often leaves labels.processing_time_seconds null, so always derive
// elapsed time from submitted_at ΓåÆ completed_at.
function getElapsedTime(job: JobStatusResponse): string {
  if (job.submitted_at && job.completed_at) {
    const diffMs =
      new Date(job.completed_at).getTime() - new Date(job.submitted_at).getTime();
    if (diffMs > 0) return formatDuration(diffMs / 1000);
  }
  return 'N/A';
}

// The model that produced the translation, e.g. "gemini-2.5-flash (v1.2)".
function formatModel(meta: TranslationResult['metadata']): string {
  const name = meta?.model_used?.trim();
  if (!name) return 'Unknown';
  const version = meta?.model_version?.trim();
  return version ? `${name} (${version})` : name;
}


// ΓöÇΓöÇΓöÇ Sub-components ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const SkeletonLoader: React.FC = () => (
  <div className="output-loading">
    {[100, 85, 92, 70, 95].map((w, i) => (
      <div key={i} className="skeleton" style={{ height: 14, width: `${w}%` }} />
    ))}
    <div className="skeleton" style={{ height: 14, width: '60%' }} />
  </div>
);

interface TranslationResultCardProps {
  job: JobStatusResponse;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onRate: () => void;
}

const TranslationResultCard: React.FC<TranslationResultCardProps> = ({
  job,
  copied,
  onCopy,
  onDownload,
  onRate,
}) => {
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed' || job.status === 'cancelled';
  const result = job.result;

  return (
    <div className={`batch-result-card ${isFailed ? 'batch-result-card--failed' : ''}`}>
      <div className="batch-result-header">
        <div className="result-meta">
          <span className="meta-chip">{result?.metadata.source_language ?? job.job_id.substring(0, 8)}</span>
          <span className="meta-arrow">ΓåÆ</span>
          <span className="meta-chip teal">{result?.metadata.target_language ?? 'ΓÇª'}</span>
        </div>
        <div className="batch-result-status">
          <span className={`status-badge status-badge--${job.status}`}>{job.status}</span>
        </div>
      </div>

      {isFailed ? (
        <div className="batch-result-error">
          {job.error_message || 'This language translation failed.'}
        </div>
      ) : (
        <div className="result-text-container">
          <p className="result-text">
            {result?.translated_document?.content || 'Document translated successfully. Use the download button to retrieve it.'}
          </p>
        </div>
      )}

      {result && (
        <div className="result-details">
          {result.labels && (
            <>
              <div className="detail-item">
                <span className="detail-label">Cost:</span>
                <span className="detail-value">${result.labels.cost_usd.toFixed(4)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Tokens:</span>
                <span className="detail-value">{result.labels.token_count}</span>
              </div>
            </>
          )}
          <div className="detail-item">
            <span className="detail-label">Time:</span>
            <span className="detail-value">{getElapsedTime(job)}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Model:</span>
            <span className="detail-value">{formatModel(result.metadata)}</span>
          </div>
        </div>
      )}

      {isCompleted && (
        <div className="batch-result-actions">
          {result?.translated_document?.content && (
            <button className={`output-action-btn ${copied ? 'copied' : ''}`} onClick={onCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
          <button
            className="output-action-btn primary icon-only"
            onClick={onDownload}
            title="Download translation"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button className="output-action-btn" onClick={onRate} title="Rate this translation">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Rate
          </button>
        </div>
      )}
    </div>
  );
};

// ΓöÇΓöÇΓöÇ Main Component ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const TranslationPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [file, setFile] = useState<File | null>(null);

  // Multi-target language selection
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLangs, setTargetLangs] = useState<string[]>(['de']);
  const [domain, setDomain] = useState('legal');
  const [enableDlp, setEnableDlp] = useState(true);
  const [enableChunking, setEnableChunking] = useState(true);
  const [priority, setPriority] = useState('standard');

  const {
    status,
    batchId,
    jobs,
    jobOrder,
    downloadInfo,
    error,
    startTranslation,
    retryOrReset,
    reset,
    getValidDownloadUrl,
  } = useTranslation();

  const [copiedJobId, setCopiedJobId] = useState<string | null>(null);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);
  const targetDropdownRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Close target-language dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (targetDropdownRef.current && !targetDropdownRef.current.contains(e.target as Node)) {
        setTargetDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ΓöÇΓöÇ Dropzone ΓöÇΓöÇ
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

  // ΓöÇΓöÇ Clear ΓöÇΓöÇ
  // Bug 7: Also reset translation state so stale output is not shown for a new file
  const clearFile = () => {
    setFile(null);
    reset();
  };

  // ── Target language multi-select ──
  const toggleTarget = (code: string) => {
    if (code === sourceLang) return; // can't translate a language into itself
    setTargetLangs((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  // When the source changes, drop it from the target selection if present.
  const handleSourceChange = (code: string) => {
    setSourceLang(code);
    setTargetLangs((prev) => prev.filter((c) => c !== code));
  };

  // ΓöÇΓöÇ Translate ΓöÇΓöÇ
  const handleTranslate = async () => {
    if (!file) return;

    if (targetLangs.length === 0) {
      alert('Please select at least one target language.');
      return;
    }

    if (targetLangs.length > 5) {
      alert('You can select up to 5 target languages.');
      return;
    }

    if (targetLangs.includes(sourceLang)) {
      alert('Source and target languages must be different.');
      return;
    }

    // Pass a factory so each retry builds fresh FormData with an unconsumed file stream.
    const buildFormData = () => {
      const fd = new FormData();
      targetLangs.forEach((lang) => fd.append('target_languages', lang));
      if (sourceLang) fd.append('source_language', sourceLang);
      fd.append('domain', domain);
      fd.append('enable_dlp', String(enableDlp));
      fd.append('enable_chunking', String(enableChunking));
      fd.append('priority', priority);
      fd.append('file', file);
      return fd;
    };

    await startTranslation(buildFormData);

    setTimeout(() => {
      if (resultRef.current) {
        resultRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 500);
  };

  // ΓöÇΓöÇ Copy ΓöÇΓöÇ
  const handleCopy = async (jobId: string) => {
    const translatedText = jobs[jobId]?.result?.translated_document?.content;
    if (!translatedText) return;
    await navigator.clipboard.writeText(translatedText);
    setCopiedJobId(jobId);
    setTimeout(() => setCopiedJobId(null), 2000);
  };

  // ΓöÇΓöÇ Download ΓöÇΓöÇ
  const handleDownload = async (jobId: string) => {
    const signedUrl = await getValidDownloadUrl(jobId)
      ?? jobs[jobId]?.result?.translated_document?.download_url;

    if (signedUrl) {
      const filename =
        downloadInfo[jobId]?.filename ??
        jobs[jobId]?.result?.translated_document?.filename ??
        `translated_${jobId}.pdf`;
      const anchor = document.createElement('a');
      anchor.href = signedUrl;
      anchor.download = filename;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } else {
      const translatedText = jobs[jobId]?.result?.translated_document?.content;
      if (!translatedText) {
        console.warn('No download URL or inline content available.');
        return;
      }
      const blob = new Blob([translatedText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translated_${jobId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // ΓöÇΓöÇ Review toast ΓöÇΓöÇ
  const handleReviewSubmitted = (ok: boolean, message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ok, message });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };

  const canTranslate =
    !!file &&
    targetLangs.length > 0 &&
    targetLangs.length <= 5 &&
    !targetLangs.includes(sourceLang);
  const isLoading = status === 'submitting' || status === 'polling';

  // ΓöÇΓöÇΓöÇ Render ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

        {/* ΓöÇΓöÇ Input Panel ΓöÇΓöÇ */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Input & Configuration</h2>
          </div>

          <div className="panel-body">
            {/* File Upload Mode */}
            {!file ? (
              <div {...getRootProps()} className={`drop-zone ${isDragActive ? 'drag-over' : ''}`}>
                <input {...getInputProps({ 'aria-label': 'Upload translation file', name: 'translation_file' })} />
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
                <p className="drop-zone-types">Supports .txt, .docx and .pdf ┬╖ Max 10 MB</p>

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

            {/* Domain field */}
            <div className="form-field">
              <label className="field-label" htmlFor="tr-domain">Domain <span className="required">*</span></label>
              <select id="tr-domain" name="domain" className="field-select" value={domain} onChange={(e) => setDomain(e.target.value)}>
                <option value="commercial">Commercial</option>
                <option value="legal">Legal</option>
                <option value="finance">Finance</option>
                <option value="hr">HR</option>
                <option value="operations">Operations</option>
              </select>
            </div>

            {/* Source language */}
            <div className="form-field">
              <label className="field-label" htmlFor="tr-source-lang">Source Language</label>
              <select id="tr-source-lang" name="source_language" className="field-select" value={sourceLang} onChange={(e) => handleSourceChange(e.target.value)}>
                {SOURCE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>

            {/* Target languages — multi-select dropdown (mirrors source language style) */}
            <div className="form-field">
              <label className="field-label" htmlFor="tr-target-lang">Target Language <span className="required">*</span></label>
              <div className="multiselect-dropdown" ref={targetDropdownRef}>
                <button
                  type="button"
                  id="tr-target-lang"
                  className={`field-select multiselect-trigger-clean ${targetDropdownOpen ? 'open' : ''}`}
                  onClick={() => setTargetDropdownOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={targetDropdownOpen}
                >
                  <span className={targetLangs.length === 0 ? 'multiselect-clean-placeholder' : 'multiselect-clean-value'}>
                    {targetLangs.length === 0
                      ? 'Select languages…'
                      : targetLangs.map((c) => langLabel(c)).join(', ')}
                  </span>
                  <span className={`multiselect-chevron ${targetDropdownOpen ? 'rotated' : ''}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </span>
                </button>
                {targetDropdownOpen && (
                  <ul className="multiselect-menu" role="listbox" aria-label="Target languages">
                    {LANGUAGES.filter((l) => l.code !== sourceLang).map((l) => {
                      const isSelected = targetLangs.includes(l.code);
                      return (
                        <li
                          key={l.code}
                          role="option"
                          aria-selected={isSelected}
                          className={`multiselect-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleTarget(l.code)}
                        >
                          <span className="multiselect-option-flag">{l.flag}</span>
                          <span className="multiselect-option-label">{l.label}</span>
                          <span className="multiselect-option-check">
                            {isSelected && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="form-grid">
              <div className="form-field">
                <label className="field-label" htmlFor="tr-enable-dlp">Enable DLP</label>
                <select id="tr-enable-dlp" name="enable_dlp" className="field-select" value={String(enableDlp)} onChange={(e) => setEnableDlp(e.target.value === 'true')}>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="tr-enable-chunking">Enable Chunking</label>
                <select id="tr-enable-chunking" name="enable_chunking" className="field-select" value={String(enableChunking)} onChange={(e) => setEnableChunking(e.target.value === 'true')}>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="tr-priority">Priority</label>
                <select id="tr-priority" name="priority" className="field-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
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
                    ? 'Submitting...'
                    : `Processing ${Object.values(jobs).filter((j) => j.status === 'completed').length}/${jobOrder.length} languages`}
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
                    <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
                  </svg>
                  Translate{targetLangs.length > 1 ? ` (${targetLangs.length} languages)` : ''}
                </>
              )}
            </button>
          </div>
        </div>

        {/* ΓöÇΓöÇ Output Panel ΓöÇΓöÇ */}
        <div className="panel" ref={resultRef}>
          <div className="panel-header">
            <h2 className="panel-title">Output</h2>
            {batchId && (
              <span className="batch-id" title={batchId}>
                Batch {batchId.substring(0, 8)}ΓÇª
              </span>
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
                <span>
                  Batch Status:{' '}
                  <strong>
                    {jobOrder.length > 0
                      ? `${Object.values(jobs).filter((j) => j.status === 'completed').length}/${jobOrder.length} completed`
                      : (status ?? 'queued').toUpperCase()}
                  </strong>
                </span>
                {jobOrder.length > 0 && (
                  <span className="job-time">
                    {Object.values(jobs).filter((j) => j.status === 'failed' || j.status === 'cancelled').length} failed
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Success / Partial results */}
          {(status === 'completed' || status === 'partial') && jobOrder.length > 0 && (
            <div className="batch-result-list">
              {jobOrder.map((jobId) => {
                const job = jobs[jobId];
                if (!job) return null;
                return (
                  <TranslationResultCard
                    key={jobId}
                    job={job}
                    copied={copiedJobId === jobId}
                    onCopy={() => handleCopy(jobId)}
                    onDownload={() => handleDownload(jobId)}
                    onRate={() => setReviewJobId(jobId)}
                  />
                );
              })}
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
              <div className="error-actions">
                <button className="retry-btn" onClick={retryOrReset} id="retry-btn">
                  {jobOrder.length > 0 ? 'Resume Checking Status' : 'Try Again'}
                </button>
                {jobOrder.length > 0 && (
                  <button className="retry-btn secondary" onClick={reset} id="reset-btn">
                    Start Over
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {reviewJobId && (
        <ReviewModal
          isOpen={!!reviewJobId}
          jobId={reviewJobId}
          onClose={() => setReviewJobId(null)}
          onSubmitted={handleReviewSubmitted}
        />
      )}

      {/* Review result toast */}
      {toast && (
        <div className={`review-toast ${toast.ok ? 'review-toast--success' : 'review-toast--error'}`} role="status" aria-live="polite">
          <div className="review-toast-icon">
            {toast.ok ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
          </div>
          <span className="review-toast-message">{toast.message}</span>
          <button className="review-toast-close" onClick={() => setToast(null)} aria-label="Dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default TranslationPage;
