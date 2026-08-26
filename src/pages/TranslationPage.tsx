import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { useTranslationJobs } from '../context/useTranslationJobs';
import { useServiceJobs } from '../hooks/useServiceJobs';
import ReviewModal from '../components/ReviewModal';
import RecentRuns from '../components/RecentRuns';
import RunJobModal from '../components/RunJobModal';
import ServiceLanding from '../components/ServiceLanding';
import '../styles/service-detail.css';
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

/** Filename given to pasted text when it's wrapped into an uploadable .txt file. */
const TEXT_INPUT_FILENAME = 'pasted-text.txt';

/** Upper bound on pasted text. Longer sources should be uploaded as a file. */
const MAX_TEXT_WORDS = 1000;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const langLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();


// ── Helpers ──────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ΓöÇΓöÇΓöÇ Main Component ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const TRANSLATION_ICON = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
  </svg>
);

const TRANSLATION_FEATURES = [
  {
    title: 'DLP and anonymization',
    description: 'Sensitive data is detected and masked before anything leaves Colt, per Colt Security Policy.',
  },
  {
    title: 'Layout preservation',
    description: 'Word and PDF structure survives the round trip — tables, footnotes and inline styling stay intact.',
  },
  {
    title: 'Domain-tuned output',
    description: 'Pick the domain (legal, finance, HR…) and the model adapts terminology and tone to match it.',
  },
];

interface TranslationPageProps {
  /** Optional "view all" link into the shared Job Tracker page. */
  onOpenTracker?: () => void;
  /** Optional back link to the hub. */
  onBack?: () => void;
}

const TranslationPage: React.FC<TranslationPageProps> = ({ onOpenTracker, onBack }) => {
  const [file, setFile] = useState<File | null>(null);
  /**
   * Paste-text alternative to uploading a file. The two inputs are mutually
   * exclusive — whichever one is in use disables the other — because the
   * backend accepts exactly one source document per job.
   */
  const [sourceText, setSourceText] = useState('');
  /** One-shot notice shown the moment pasted text crosses the word limit. */
  const [showWordLimitNotice, setShowWordLimitNotice] = useState(false);
  /** Notice shown when an uploaded file exceeds the 10 MB limit. */
  const [showFileSizeNotice, setShowFileSizeNotice] = useState<number | null>(null);

  // Multi-target language selection
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLangs, setTargetLangs] = useState<string[]>(['de']);
  const [domain, setDomain] = useState('legal');
  // enable_dlp, enable_chunking, and priority are no longer surfaced in the
  // UI -- the backend (Translation service) already applies these exact
  // defaults (enable_dlp=True, enable_chunking=True, priority="standard")
  // when the fields are omitted from the request, so there is nothing to
  // send here. See Translation/src/api/routes/v1/translate.py and
  // Translation/src/api/schemas/requests.py.


  const {
    status,
    jobOrder,
    error,
    startTranslation,
    retryOrReset,
    reset,
  } = useTranslationJobs();

  const serviceJobs = useServiceJobs('translation');
  const [runOpen, setRunOpen] = useState(false);

  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);
  const targetDropdownRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Recent runs is scrolled into view after submit — it's now the only place progress/results show. */
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

  const showToast = useCallback((ok: boolean, message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ok, message });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  // ── Dropzone ──
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) setFile(accepted[0]);
  }, []);

  const onDropRejected = useCallback(
    (fileRejections: FileRejection[]) => {
      if (!fileRejections.length) return;
      const rejection = fileRejections[0];
      const isTooLarge = rejection.errors.some((e) => e.code === 'file-too-large');
      const isInvalidType = rejection.errors.some((e) => e.code === 'file-invalid-type');
      if (isTooLarge) {
        setShowFileSizeNotice(rejection.file.size);
      } else if (isInvalidType) {
        showToast(false, 'Unsupported file format. Please upload a .txt, .docx, or .pdf file.');
      } else {
        showToast(false, rejection.errors[0]?.message || 'File upload was rejected.');
      }
    },
    [showToast],
  );

  const hasText = sourceText.trim().length > 0;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      'text/plain': ['.txt'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf']
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    noClick: false,
    // Typing into the text box takes over as the source, so uploading is
    // switched off until the box is cleared.
    disabled: hasText,
  });

  // ── Clear ──
  const clearFile = () => {
    setFile(null);
    setShowFileSizeNotice(null);
  };

  const clearText = () => {
    setSourceText('');
    setShowWordLimitNotice(false);
  };

  // Fires the notice only on the transition into over-limit, so it doesn't
  // reappear on every keystroke once the text is already too long.
  const handleTextChange = (value: string) => {
    const wasOver = countWords(sourceText) > MAX_TEXT_WORDS;
    const isOver = countWords(value) > MAX_TEXT_WORDS;
    setSourceText(value);
    if (isOver && !wasOver) setShowWordLimitNotice(true);
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

  // ── Translate ──
  const handleTranslate = async () => {
    if (!file && !hasText) return;

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

    const currentFile = file;
    const currentSourceText = sourceText;
    const currentTargetLangs = [...targetLangs];
    const currentSourceLang = sourceLang;
    const currentDomain = domain;

    // Pass a factory so each retry builds fresh FormData with an unconsumed file stream.
    const buildFormData = () => {
      const fd = new FormData();
      currentTargetLangs.forEach((lang) => fd.append('target_languages', lang));
      if (currentSourceLang) fd.append('source_language', currentSourceLang);
      fd.append('domain', currentDomain);
      fd.append(
        'file',
        currentFile ?? new File([currentSourceText], TEXT_INPUT_FILENAME, { type: 'text/plain' }),
      );

      return fd;
    };

    // Close the run dialog immediately and reset form fields so the next run starts fresh
    setRunOpen(false);
    setFile(null);
    setSourceText('');
    setShowWordLimitNotice(false);
    setShowFileSizeNotice(null);

    setIsSubmitting(true);
    try {
      await startTranslation(buildFormData);
    } catch {
      // Handled in context
    } finally {
      setIsSubmitting(false);
    }

    setTimeout(() => {
      if (resultRef.current) {
        resultRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 500);
  };

  // ── Review toast ──
  const handleReviewSubmitted = (ok: boolean, message: string) => {
    showToast(ok, message);
  };

  const wordCount = countWords(sourceText);
  const textTooLong = wordCount > MAX_TEXT_WORDS;

  const canTranslate =
    (!!file || hasText) &&
    !textTooLong &&
    targetLangs.length > 0 &&
    targetLangs.length <= 5 &&
    !targetLangs.includes(sourceLang) &&
    !isSubmitting;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="page-content">
      <ServiceLanding
        category="Language"
        name="Translation"
        description="Enterprise document translation with automated DLP and anonymization, integrated with Colt's Security Policy. Word and PDF structure is preserved end to end."
        icon={TRANSLATION_ICON}
        runLabel="New translation"
        onRun={() => setRunOpen(true)}
        onOpenTracker={onOpenTracker}
        onBack={onBack}
        stats={serviceJobs.stats}
        features={TRANSLATION_FEATURES}
        returns={['txt', 'docx', 'pdf']}
      />


      {/* Run dialog — the input/config form lives here, not on the page. */}
      <RunJobModal
        isOpen={runOpen}
        onClose={() => setRunOpen(false)}
        serviceName="Translation"
        serviceIcon={TRANSLATION_ICON}
        submitLabel={`Start job${targetLangs.length > 1 ? ` (${targetLangs.length} languages)` : ''}`}
        submitting={isSubmitting}
        canSubmit={canTranslate}
        onSubmit={handleTranslate}
      >
        {/* Source: upload a file OR paste text — never both. */}
        {!file ? (
          <div
            {...getRootProps()}
            className={`drop-zone ${isDragActive ? 'drag-over' : ''} ${hasText ? 'drop-zone--disabled' : ''}`}
            aria-disabled={hasText}
            title={hasText ? 'Clear the text box to upload a file instead' : undefined}
          >
            {/* `disabled` is set explicitly as well as via useDropzone —
                react-dropzone doesn't forward it to the input, and
                pointer-events alone wouldn't block keyboard access. */}
            <input
              {...getInputProps({
                'aria-label': 'Upload translation file',
                name: 'translation_file',
                disabled: hasText,
              })}
            />
            <div className="drop-zone-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17,8 12,3 7,8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <p className="drop-zone-title">
              {hasText ? 'Upload disabled' : isDragActive ? 'Drop it here!' : 'Drop your file here'}
            </p>
            <p className="drop-zone-sub">
              {hasText ? (
                'Clear the text below to upload a file instead'
              ) : (
                <>or <span className="drop-zone-link">browse to upload</span></>
              )}
            </p>
            {!hasText && <p className="drop-zone-types">Supports .txt, .docx and .pdf · Max 10 MB</p>}
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
            <button type="button" className="file-remove-btn" onClick={clearFile} title="Remove file">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        )}

        <div className="source-divider"><span>or</span></div>

        {/* Paste-text source */}
        <div className="form-field">
          <div className="field-label-row">
            <label className="field-label" htmlFor="tr-source-text">
              Paste text <span className="field-label-muted">(max {MAX_TEXT_WORDS} words)</span>
            </label>
            {hasText && (
              <button type="button" className="field-label-action" onClick={clearText}>
                Clear
              </button>
            )}
          </div>
          <textarea
            id="tr-source-text"
            name="source_text"
            className={`field-textarea ${textTooLong ? 'field-textarea--error' : ''}`}
            rows={5}
            placeholder={
              file
                ? 'Remove the uploaded file to paste text instead'
                : `Paste up to ${MAX_TEXT_WORDS} words…`
            }
            value={sourceText}
            onChange={(e) => handleTextChange(e.target.value)}
            disabled={!!file}
            aria-invalid={textTooLong}
          />
          <div className="field-hint-row">
            <p className={`field-hint ${textTooLong ? 'field-hint--error' : ''}`}>
              {textTooLong
                ? `Too long by ${wordCount - MAX_TEXT_WORDS} word${wordCount - MAX_TEXT_WORDS === 1 ? '' : 's'} — shorten it or upload a file instead.`
                : 'Translated as a .txt file, returned the same way.'}
            </p>
            {!file && (
              <span className={`field-counter ${textTooLong ? 'field-counter--error' : ''}`}>
                {wordCount} / {MAX_TEXT_WORDS}
              </span>
            )}
          </div>
        </div>

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
              <label className="field-label" htmlFor="tr-target-lang">Target Language/s <span className="required">*</span></label>
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

      </RunJobModal>

      {/* Word-limit notice. Rendered as a sibling of the run dialog rather
          than inside it: the dialog panel animates with a transform, which
          would become the containing block for a position:fixed child and
          trap this overlay inside the panel. */}
      {showWordLimitNotice && (
        <div
          className="notice-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="word-limit-title"
          onClick={() => setShowWordLimitNotice(false)}
        >
          <div className="notice-panel" onClick={(e) => e.stopPropagation()}>
            <div className="notice-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h3 className="notice-title" id="word-limit-title">
              Text is limited to {MAX_TEXT_WORDS} words
            </h3>
            <p className="notice-body">
              You've pasted {wordCount.toLocaleString()} words. Shorten it to{' '}
              {MAX_TEXT_WORDS} or fewer, or upload the full document as a file
              instead — uploads have no word limit.
            </p>
            <button
              type="button"
              className="notice-btn"
              onClick={() => setShowWordLimitNotice(false)}
              autoFocus
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* File size limit notice (10 MB max) */}
      {showFileSizeNotice !== null && (
        <div
          className="notice-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="file-size-title"
          onClick={() => setShowFileSizeNotice(null)}
        >
          <div className="notice-panel" onClick={(e) => e.stopPropagation()}>
            <div className="notice-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h3 className="notice-title" id="file-size-title">
              File exceeds 10 MB limit
            </h3>
            <p className="notice-body">
              {showFileSizeNotice ? `The file you selected is ${formatBytes(showFileSizeNotice)}. ` : ''}
              Please select or compress your document to be 10 MB or smaller (.txt, .docx, or .pdf).
            </p>
            <button
              type="button"
              className="notice-btn"
              onClick={() => setShowFileSizeNotice(null)}
              autoFocus
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Batch-level failure — kept because it carries retry/reset actions
          that the per-run list has no equivalent for. */}
      {status === 'failed' && (
        <div className="workspace workspace--output">
          <div className="panel">
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
          </div>
        </div>
      )}

      <div ref={resultRef}>
        <RecentRuns
          jobs={serviceJobs.jobs}
          loading={serviceJobs.loading}
          loadError={serviceJobs.loadError}
          actionError={serviceJobs.actionError}
          busyKey={serviceJobs.busyKey}
          onRefresh={serviceJobs.refresh}
          onCancel={serviceJobs.cancelJob}
          onDownload={serviceJobs.downloadJob}
          onLoadDetail={serviceJobs.loadDetail}
          onFeedback={(job) => setReviewJobId(job.id)}
          onOpenTracker={onOpenTracker}
        />
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
