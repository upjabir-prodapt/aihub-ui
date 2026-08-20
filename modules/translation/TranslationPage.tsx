'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import {
  Languages,
  Upload,
  FileText,
  X,
  Copy,
  Check,
  Download,
  Star,
  AlertCircle,
  Loader2,
  ChevronDown,
  Sparkles,
  ShieldCheck,
  FileType,
} from 'lucide-react';
import { useTranslation } from '@/modules/translation/useTranslation';
import ReviewModal from '@/modules/translation/ReviewModal';

import type { JobStatusResponse, TranslationResult } from '@/modules/translation/translation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ── Constants ────────────────────────────────────────────────
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

// ── Helpers ────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function getElapsedTime(job: JobStatusResponse): string {
  if (job.submitted_at && job.completed_at) {
    const diffMs =
      new Date(job.completed_at).getTime() - new Date(job.submitted_at).getTime();
    if (diffMs > 0) return formatDuration(diffMs / 1000);
  }
  return 'N/A';
}

function formatModel(meta: TranslationResult['metadata']): string {
  const name = meta?.model_used?.trim();
  if (!name) return 'Unknown';
  const version = meta?.model_version?.trim();
  return version ? `${name} (${version})` : name;
}

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'success' | 'destructive' | 'warning' | 'secondary'> = {
  completed: 'success',
  failed: 'destructive',
  cancelled: 'destructive',
  processing: 'warning',
  queued: 'secondary',
};

// ── Sub-components ────────────────────────────────────────────

const SkeletonLoader: React.FC = () => (
  <div className="space-y-2.5 p-4">
    {[100, 85, 92, 70, 95].map((w, i) => (
      <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
    ))}
    <Skeleton className="h-3.5 w-3/5" />
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
    <Card className={cn(
      "transition-all duration-200",
      isFailed && "border-red-500/20 bg-red-500/5"
    )}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="px-2 py-1 rounded-md bg-bg-elevated text-text-secondary">
            {result?.metadata.source_language?.toUpperCase() ?? job.job_id.substring(0, 8)}
          </span>
          <span className="text-text-muted">→</span>
          <span className="px-2 py-1 rounded-md bg-colt-teal/10 text-colt-teal">
            {result?.metadata.target_language?.toUpperCase() ?? '···'}
          </span>
        </div>
        <Badge variant={STATUS_BADGE_VARIANT[job.status] ?? 'secondary'} className="uppercase">
          {job.status}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {isFailed ? (
          <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/5 p-3 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{job.error_message || 'This language translation failed.'}</span>
          </div>
        ) : (
          <div className="max-h-40 overflow-y-auto rounded-lg bg-bg-elevated/50 p-3 border border-border-subtle">
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
              {result?.translated_document?.content || 'Document translated successfully. Use the download button to retrieve it.'}
            </p>
          </div>
        )}

        {result && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {result.labels && (
              <>
                <div className="flex justify-between border-b border-border-subtle/50 pb-1">
                  <span className="text-text-muted">Cost</span>
                  <span className="font-medium text-text-primary">{typeof result.labels.cost_usd === 'number' ? `$${result.labels.cost_usd.toFixed(4)}` : '—'}</span>
                </div>
                <div className="flex justify-between border-b border-border-subtle/50 pb-1">
                  <span className="text-text-muted">Tokens</span>
                  <span className="font-medium text-text-primary">{result.labels.token_count ?? '—'}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-b border-border-subtle/50 pb-1">
              <span className="text-text-muted">Time</span>
              <span className="font-medium text-text-primary">{getElapsedTime(job)}</span>
            </div>
            <div className="flex justify-between border-b border-border-subtle/50 pb-1">
              <span className="text-text-muted">Model</span>
              <span className="font-medium text-text-primary truncate ml-2">{formatModel(result.metadata)}</span>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="flex items-center gap-2 pt-1">
            {result?.translated_document?.content && (
              <Button variant="outline" size="sm" onClick={onCopy} className="cursor-pointer flex-1">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            )}
            <Button size="sm" onClick={onDownload} title="Download translation" className="cursor-pointer">
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={onRate} title="Rate this translation" className="cursor-pointer">
              <Star className="w-3.5 h-3.5" />
              Rate
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ── Main Component ────────────────────────────────────────────
const TranslationPage: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);

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
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);
  const targetDropdownRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (targetDropdownRef.current && !targetDropdownRef.current.contains(e.target as Node)) {
        setTargetDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const clearFile = () => {
    setFile(null);
    reset();
  };

  const toggleTarget = (code: string) => {
    if (code === sourceLang) return;
    setTargetLangs((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleSourceChange = (code: string) => {
    setSourceLang(code);
    setTargetLangs((prev) => prev.filter((c) => c !== code));
  };

  const handleTranslate = async () => {
    if (!file) return;

    if (targetLangs.length === 0) {
      toast.error('Please select at least one target language.');
      return;
    }

    if (targetLangs.length > 5) {
      toast.error('You can select up to 5 target languages.');
      return;
    }

    if (targetLangs.includes(sourceLang)) {
      toast.error('Source and target languages must be different.');
      return;
    }

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

  const handleCopy = async (jobId: string) => {
    const translatedText = jobs[jobId]?.result?.translated_document?.content;
    if (!translatedText) return;
    await navigator.clipboard.writeText(translatedText);
    setCopiedJobId(jobId);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedJobId(null), 2000);
  };

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
        toast.error('No download URL or inline content available.');
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

  const handleReviewSubmitted = (ok: boolean, message: string) => {
    if (ok) toast.success(message);
    else toast.error(message);
  };

  const canTranslate =
    !!file &&
    targetLangs.length > 0 &&
    targetLangs.length <= 5 &&
    !targetLangs.includes(sourceLang);
  const isLoading = status === 'submitting' || status === 'polling';

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-bg-base">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-lg bg-bg-surface border border-border-subtle p-7 mb-6 shadow-md">
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-colt-teal/10 rounded-full blur-3xl" />
        <div className="absolute top-0 left-0 w-1.5 h-full bg-colt-teal" />
        <div className="relative flex flex-wrap items-center justify-between gap-4 pl-3">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-md bg-colt-teal/10 border border-colt-teal/20 flex items-center justify-center text-colt-teal shrink-0">
              <Languages className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-colt-teal mb-1">
                <span>»</span> AI CoE Hub
              </div>
              <h1 className="text-2xl font-extrabold text-text-primary uppercase tracking-tight leading-none">AI Translation Service</h1>
              <p className="text-sm text-text-secondary max-w-xl mt-2">
                Enterprise translation with automated DLP and anonymization, structure-preserving Word & PDF conversion.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-lg font-bold text-text-primary">6</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wide">Languages</div>
            </div>
            <div className="w-px h-8 bg-border-subtle" />
            <div className="text-center flex flex-col items-center">
              <ShieldCheck className="w-4 h-4 text-colt-teal mb-0.5" />
              <div className="text-[10px] text-text-muted uppercase tracking-wide">Secure DLP</div>
            </div>
            <div className="w-px h-8 bg-border-subtle" />
            <div className="text-center flex flex-col items-center">
              <FileType className="w-4 h-4 text-colt-teal mb-0.5" />
              <div className="text-[10px] text-text-muted uppercase tracking-wide">PDF/Word</div>
            </div>
          </div>
        </div>
      </div>

      {/* Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Input Panel */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-text-primary">Input & Configuration</h2>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* File Upload */}
            {!file ? (
              <div
                {...getRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors duration-150",
                  isDragActive ? "border-colt-teal bg-colt-teal/5" : "border-border-default hover:border-colt-teal/50 hover:bg-bg-hover/50"
                )}
              >
                <input {...getInputProps({ 'aria-label': 'Upload translation file', name: 'translation_file' })} />
                <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-bg-elevated flex items-center justify-center text-text-secondary">
                  <Upload className="w-5 h-5" />
                </div>
                <p className="text-sm font-semibold text-text-primary">
                  {isDragActive ? 'Drop it here!' : 'Drop your file here'}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  or <span className="text-colt-teal font-medium">browse to upload</span>
                </p>
                <p className="text-[10px] text-text-muted mt-3">Supports .txt, .docx and .pdf · Max 10 MB</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-border-default bg-bg-elevated/50">
                <div className="w-9 h-9 rounded-lg bg-colt-teal/10 text-colt-teal flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{file.name}</div>
                  <div className="text-xs text-text-muted">{formatBytes(file.size)}</div>
                </div>
                <button onClick={clearFile} title="Remove file" className="text-text-muted hover:text-red-400 transition-colors cursor-pointer p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Domain field */}
            <div className="space-y-1.5">
              <Label htmlFor="tr-domain">Domain <span className="text-red-400">*</span></Label>
              <Select id="tr-domain" name="domain" value={domain} onChange={(e) => setDomain(e.target.value)}>
                <option value="commercial">Commercial</option>
                <option value="legal">Legal</option>
                <option value="finance">Finance</option>
                <option value="hr">HR</option>
                <option value="operations">Operations</option>
              </Select>
            </div>

            {/* Source language */}
            <div className="space-y-1.5">
              <Label htmlFor="tr-source-lang">Source Language</Label>
              <Select id="tr-source-lang" name="source_language" value={sourceLang} onChange={(e) => handleSourceChange(e.target.value)}>
                {SOURCE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </Select>
            </div>

            {/* Target languages — multi-select dropdown */}
            <div className="space-y-1.5">
              <Label htmlFor="tr-target-lang">Target Language <span className="text-red-400">*</span></Label>
              <div className="relative" ref={targetDropdownRef}>
                <button
                  type="button"
                  id="tr-target-lang"
                  className={cn(
                    "flex h-9 w-full items-center justify-between rounded-md border border-border-default bg-bg-surface px-3 py-1 text-sm shadow-sm cursor-pointer",
                    targetDropdownOpen && "ring-1 ring-colt-teal border-colt-teal"
                  )}
                  onClick={() => setTargetDropdownOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={targetDropdownOpen}
                >
                  <span className={targetLangs.length === 0 ? 'text-text-muted' : 'text-text-primary'}>
                    {targetLangs.length === 0
                      ? 'Select languages…'
                      : targetLangs.map((c) => langLabel(c)).join(', ')}
                  </span>
                  <ChevronDown className={cn("w-3.5 h-3.5 text-text-muted transition-transform", targetDropdownOpen && "rotate-180")} />
                </button>
                {targetDropdownOpen && (
                  <ul className="absolute z-20 mt-1 w-full rounded-md border border-border-default bg-bg-surface shadow-lg py-1 max-h-56 overflow-y-auto" role="listbox" aria-label="Target languages">
                    {LANGUAGES.filter((l) => l.code !== sourceLang).map((l) => {
                      const isSelected = targetLangs.includes(l.code);
                      return (
                        <li
                          key={l.code}
                          role="option"
                          aria-selected={isSelected}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-bg-hover",
                            isSelected && "bg-colt-teal/5 text-colt-teal"
                          )}
                          onClick={() => toggleTarget(l.code)}
                        >
                          <span>{l.flag}</span>
                          <span className="flex-1">{l.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tr-enable-dlp">DLP</Label>
                <Select id="tr-enable-dlp" name="enable_dlp" value={String(enableDlp)} onChange={(e) => setEnableDlp(e.target.value === 'true')}>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-enable-chunking">Chunking</Label>
                <Select id="tr-enable-chunking" name="enable_chunking" value={String(enableChunking)} onChange={(e) => setEnableChunking(e.target.value === 'true')}>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-priority">Priority</Label>
                <Select id="tr-priority" name="priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="standard">Standard</option>
                  <option value="high">High</option>
                </Select>
              </div>
            </div>

            {/* Translate Button */}
            <Button
              className="w-full h-10 cursor-pointer"
              onClick={handleTranslate}
              disabled={!canTranslate || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {status === 'submitting'
                    ? 'Submitting...'
                    : `Processing ${Object.values(jobs).filter((j) => j.status === 'completed').length}/${jobOrder.length} languages`}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Translate{targetLangs.length > 1 ? ` (${targetLangs.length} languages)` : ''}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Output Panel */}
        <Card ref={resultRef as React.RefObject<HTMLDivElement>}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <h2 className="text-sm font-bold text-text-primary">Output</h2>
            {batchId && (
              <span className="text-[10px] text-text-muted font-mono" title={batchId}>
                Batch {batchId.substring(0, 8)}…
              </span>
            )}
          </CardHeader>

          <CardContent className="space-y-3">
            {/* Idle */}
            {status === 'idle' && (
              <div className="flex flex-col items-center justify-center text-center py-16">
                <div className="w-14 h-14 rounded-full bg-bg-elevated flex items-center justify-center text-text-muted mb-4">
                  <Languages className="w-7 h-7" />
                </div>
                <p className="text-sm font-semibold text-text-primary">No translation yet</p>
                <p className="text-xs text-text-secondary mt-1 max-w-xs">
                  Fill in the details and click <strong>Translate</strong> to start a job.
                </p>
              </div>
            )}

            {/* Loading / Polling */}
            {isLoading && (
              <div className="space-y-3">
                <SkeletonLoader />
                <div className="flex items-center gap-2 text-xs text-text-secondary px-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-colt-teal animate-pulse" />
                  <span>
                    Batch Status:{' '}
                    <strong className="text-text-primary">
                      {jobOrder.length > 0
                        ? `${Object.values(jobs).filter((j) => j.status === 'completed').length}/${jobOrder.length} completed`
                        : (status ?? 'queued').toUpperCase()}
                    </strong>
                  </span>
                  {jobOrder.length > 0 && (
                    <span className="ml-auto text-text-muted">
                      {Object.values(jobs).filter((j) => j.status === 'failed' || j.status === 'cancelled').length} failed
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Success / Partial results */}
            {(status === 'completed' || status === 'partial') && jobOrder.length > 0 && (
              <div className="space-y-3">
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
              <div className="flex flex-col items-center justify-center text-center py-12">
                <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mb-4">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-text-primary">Translation Failed</p>
                <p className="text-xs text-text-secondary mt-1 max-w-xs">{error}</p>
                <div className="flex gap-2 mt-4">
                  <Button size="sm" onClick={retryOrReset} className="cursor-pointer">
                    {jobOrder.length > 0 ? 'Resume Checking Status' : 'Try Again'}
                  </Button>
                  {jobOrder.length > 0 && (
                    <Button size="sm" variant="outline" onClick={reset} className="cursor-pointer">
                      Start Over
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {reviewJobId && (
        <ReviewModal
          isOpen={!!reviewJobId}
          jobId={reviewJobId}
          onClose={() => setReviewJobId(null)}
          onSubmitted={handleReviewSubmitted}
        />
      )}
    </div>
  );
};

export default TranslationPage;
