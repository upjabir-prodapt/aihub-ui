import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { User, LogOut } from 'lucide-react';
import { useMultiTranslation, LangJobStatus, type LanguageJob } from '../hooks/useMultiTranslation';
import { useAuth } from '../context/useAuth';
import ReviewModal from '../components/ReviewModal';
import type { JobStatusResponse, TranslationResult } from '../types/translation';
import '../styles/translation.css';

// ─── Constants ────────────────────────────────────────────
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
const langFlag = (code: string) => LANGUAGES.find((l) => l.code === code)?.flag ?? '🌐';

// ─── Helpers ──────────────────────────────────────────────
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
// elapsed time from submitted_at → completed_at.
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

// A short, human-friendly status line for a running job.
function runningLabel(job: LanguageJob): string {
  if (job.status === LangJobStatus.Submitting) return 'Submitting…';
  const s = job.jobData?.status ?? 'queued';
  return s.charAt(0).toUpperCase() + s.slice(1);
}


// ─── Sub-components ───────────────────────────────────────

const SkeletonLoader: React.FC = () => (
  <div className="card-skeleton">
    {[100, 82, 92].map((w, i) => (
      <div key={i} className="skeleton" style={{ height: 10, width: `${w}%` }} />
    ))}
  </div>
);

// ─── Main Component ───────────────────────────────────────
const TranslationPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [file, setFile] = useState<File | null>(null);

  // Configuration
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLangs, setTargetLangs] = useState<string[]>(['de']);
  const [domain, setDomain] = useState('legal');
  const [enableDlp, setEnableDlp] = useState(true);
  const [enableChunking, setEnableChunking] = useState(true);
  const [priority, setPriority] = useState('standard');

  const { jobs, isRunning, startTranslations, retryLang, getValidDownloadUrl, reset } =
    useMultiTranslation();

  const [copiedLang, setCopiedLang] = useState<string | null>(null);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      'application/pdf': ['.pdf'],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    noClick: false,
  });

  // ── Clear ──
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

  // Factory that builds a fresh FormData per language (unconsumed file stream each time).
  const makeBuildFormData = (uploaded: File) => (targetLang: string) => {
    const fd = new FormData();
    fd.append('target_language', targetLang);
    if (sourceLang) fd.append('source_language', sourceLang);
    fd.append('domain', domain);
    fd.append('enable_dlp', String(enableDlp));
    fd.append('enable_chunking', String(enableChunking));
    fd.append('priority', priority);
    fd.append('file', uploaded);
    return fd;
  };

  // ── Translate ──
  const handleTranslate = () => {
    if (!file || targetLangs.length === 0) return;

    startTranslations(targetLangs, makeBuildFormData(file));

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 200);
  };

  const handleRetryLang = (targetLang: string) => {
    if (!file) return;
    retryLang(targetLang, makeBuildFormData(file));
  };

  // ── Copy ──
  const handleCopy = async (job: LanguageJob) => {
    const translatedText = job.jobData?.result?.translated_document?.content;
    if (!translatedText) return;
    await navigator.clipboard.writeText(translatedText);
    setCopiedLang(job.targetLang);
    setTimeout(() => setCopiedLang((c) => (c === job.targetLang ? null : c)), 2000);
  };

  // ── Download ──
  const handleDownload = async (job: LanguageJob) => {
    const signedUrl =
      (await getValidDownloadUrl(job.targetLang)) ??
      job.jobData?.result?.translated_document?.download_url;

    if (signedUrl) {
      const filename =
        job.downloadInfo?.filename ??
        job.jobData?.result?.translated_document?.filename ??
        `translated_${job.targetLang}_${Date.now()}.pdf`;
      const anchor = document.createElement('a');
      anchor.href = signedUrl;
      anchor.download = filename;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
      return;
    }

    // Fallback: download inline text content if present
    const translatedText = job.jobData?.result?.translated_document?.content;
    if (!translatedText) {
      console.warn('No download URL or inline content available.');
      return;
    }
    const blob = new Blob([translatedText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translated_${job.targetLang}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Review toast ──
  const handleReviewSubmitted = (ok: boolean, message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ok, message });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };

  const canTranslate = !!file && targetLangs.length > 0;
  const completedCount = jobs.filter((j) => j.status === LangJobStatus.Completed).length;
  const failedCount = jobs.filter((j) => j.status === LangJobStatus.Failed).length;
  const runningCount = jobs.length - completedCount - failedCount;
  const hasJobs = jobs.length > 0;

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
              Translate one document into multiple languages at once — each runs in parallel.
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
              <div className="stat-value">Multi</div>
              <div className="stat-label">Parallel Jobs</div>
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

            {/* Domain */}
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

            {/* Target languages — multi-select chips */}
            <div className="form-field">
              <div className="targets-label-row">
                <label className="field-label">
                  Target Languages <span className="required">*</span>
                </label>
                <span className="targets-count">{targetLangs.length} selected</span>
              </div>
              <div className="lang-chip-grid" role="group" aria-label="Target languages">
                {LANGUAGES.map((l) => {
                  const isSource = l.code === sourceLang;
                  const isSelected = targetLangs.includes(l.code);
                  return (
                    <button
                      key={l.code}
                      type="button"
                      className={`lang-chip ${isSelected ? 'selected' : ''} ${isSource ? 'is-source' : ''}`}
                      onClick={() => toggleTarget(l.code)}
                      disabled={isSource}
                      aria-pressed={isSelected}
                      title={isSource ? 'Source language' : isSelected ? 'Click to remove' : 'Click to add'}
                    >
                      <span className="lang-chip-flag">{l.flag}</span>
                      <span className="lang-chip-label">{l.label}</span>
                      {isSource ? (
                        <span className="lang-chip-tag">Source</span>
                      ) : (
                        <span className="lang-chip-check" aria-hidden="true">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
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
              disabled={!canTranslate || isRunning}
            >
              {isRunning ? (
                <>
                  <span className="spinner" />
                  Translating {jobs.length} {jobs.length === 1 ? 'language' : 'languages'}…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
                    <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
                  </svg>
                  {targetLangs.length > 1
                    ? `Translate to ${targetLangs.length} languages`
                    : 'Translate'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Output Panel ── */}
        <div className="panel" ref={resultRef}>
          <div className="panel-header">
            <h2 className="panel-title">Output</h2>
            {hasJobs && (
              <div className="output-summary">
                <span className="summary-chip summary-done">{completedCount} done</span>
                {runningCount > 0 && (
                  <span className="summary-chip summary-running">
                    <span className="pulse-dot" />
                    {runningCount} running
                  </span>
                )}
                {failedCount > 0 && (
                  <span className="summary-chip summary-failed">{failedCount} failed</span>
                )}
              </div>
            )}
          </div>

          {/* Idle */}
          {!hasJobs && (
            <div className="output-placeholder">
              <div className="output-placeholder-icon">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/>
                  <path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>
                </svg>
              </div>
              <p className="output-placeholder-title">No translations yet</p>
              <p className="output-placeholder-sub">
                Pick one or more <strong>target languages</strong> and click <strong>Translate</strong> —
                each language runs as its own job.
              </p>
            </div>
          )}

          {/* Result cards — one per target language, scrollable */}
          {hasJobs && (
            <div className="result-cards">
              {jobs.map((job) => {
                const result = job.jobData?.result;
                const doc = result?.translated_document;
                const isBusy =
                  job.status === LangJobStatus.Submitting || job.status === LangJobStatus.Polling;
                return (
                  <div key={job.targetLang} className={`result-card status-${job.status}`}>
                    {/* Card header */}
                    <div className="result-card-header">
                      <div className="result-card-lang">
                        <span className="result-card-flag">{langFlag(job.targetLang)}</span>
                        <div className="result-card-route">
                          <span className="result-card-target">{langLabel(job.targetLang)}</span>
                          <span className="result-card-source">from {langLabel(sourceLang)}</span>
                        </div>
                      </div>
                      <span className={`status-badge status-badge-${job.status}`}>
                        {isBusy && <span className="pulse-dot" />}
                        {job.status === LangJobStatus.Completed
                          ? 'Completed'
                          : job.status === LangJobStatus.Failed
                            ? 'Failed'
                            : runningLabel(job)}
                      </span>
                    </div>

                    {/* Card body */}
                    {isBusy && (
                      <div className="result-card-body">
                        <SkeletonLoader />
                      </div>
                    )}

                    {job.status === LangJobStatus.Failed && (
                      <div className="result-card-body">
                        <div className="card-error">
                          <p className="card-error-msg">{job.error || 'Translation failed.'}</p>
                          <button
                            className="retry-btn card-retry-btn"
                            onClick={() => handleRetryLang(job.targetLang)}
                            disabled={!file}
                          >
                            Retry {langLabel(job.targetLang)}
                          </button>
                        </div>
                      </div>
                    )}

                    {job.status === LangJobStatus.Completed && result && (
                      <>
                        <div className="result-card-body">
                          <p className="result-card-text">
                            {doc?.content ||
                              'Document translated successfully. Use Download to retrieve it.'}
                          </p>
                        </div>

                        <div className="result-card-meta">
                          {result.labels && (
                            <>
                              <div className="detail-item">
                                <span className="detail-label">Cost</span>
                                <span className="detail-value">${result.labels.cost_usd.toFixed(4)}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Tokens</span>
                                <span className="detail-value">{result.labels.token_count}</span>
                              </div>
                            </>
                          )}
                          <div className="detail-item">
                            <span className="detail-label">Time</span>
                            <span className="detail-value">{getElapsedTime(job.jobData!)}</span>
                          </div>
                          <div className="detail-item detail-item-model">
                            <span className="detail-label">Model</span>
                            <span className="detail-value">{formatModel(result.metadata)}</span>
                          </div>
                        </div>

                        <div className="result-card-actions">
                          {doc?.content && (
                            <button
                              className={`output-action-btn ${copiedLang === job.targetLang ? 'copied' : ''}`}
                              onClick={() => handleCopy(job)}
                            >
                              {copiedLang === job.targetLang ? 'Copied!' : 'Copy'}
                            </button>
                          )}
                          <button
                            className="output-action-btn primary"
                            onClick={() => handleDownload(job)}
                            title={job.downloadInfo?.filename ? `Download · ${job.downloadInfo.filename}` : 'Download'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Download
                          </button>
                          {job.jobId && (
                            <button
                              className="output-action-btn"
                              onClick={() => setReviewJobId(job.jobId)}
                              title="Rate this translation"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                              </svg>
                              Rate
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
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
