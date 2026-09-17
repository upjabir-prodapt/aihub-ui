import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, useLanguage, type Language } from '../language/LanguageContext';
import './LanguageSelect.css';

// Each language's own name for itself, shown in parentheses beside the
// English name (e.g. "Japanese (日本語)") — skipped for English since
// there's nothing to translate there. Deliberately NOT run through i18n's
// t() — these are the *other* languages' own endonyms, not this app's UI
// copy, so they stay fixed regardless of which language is active.
const NATIVE_NAMES: Record<Language, string> = {
  English: 'English',
  Japanese: '日本語',
};

function optionLabel(lang: Language): string {
  return lang === 'English' ? lang : `${lang} (${NATIVE_NAMES[lang]})`;
}

interface LanguageSelectProps {
  /** Pass 'on-hero' when placing this over a colored/gradient background
   * (e.g. Landing's teal hero) where the default surface-colored trigger
   * would be invisible — same convention as ThemeToggle's variant prop.
   * The dropdown panel itself always uses a solid theme-aware background
   * regardless of variant (see LanguageSelect.css). */
  variant?: 'default' | 'on-hero';
}

// Sets both the language the AGENT/LLM's chat replies use AND this app's
// own UI text (see language/LanguageContext.tsx, which bridges to
// i18n/index.ts) — one selector, two independent effects. The visible
// label still calls out the agent side specifically since that's the
// less obvious of the two.
//
// Hand-built (not a native <select>) so: (1) the whole pill is one
// button — clicking anywhere on it, not just the value/chevron end,
// opens the menu; (2) the open menu is styled with this app's own theme
// tokens, since a native <select>'s dropdown is OS-rendered and mostly
// ignores CSS, which was the direct cause of it staying light-themed
// even in dark mode; (3) the menu is positioned and sized by this
// component, so it spans the trigger's full width instead of a native
// dropdown's own (narrower, right-anchored) sizing.
export default function LanguageSelect({ variant = 'default' }: LanguageSelectProps) {
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div
      className={`language-select${variant === 'on-hero' ? ' language-select--on-hero' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="language-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('language.selectTooltip')}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="language-select-label">{t('language.agentLanguage')}</span>
        <span className="language-select-value">{language}</span>
        <ChevronDown size={16} className={`language-select-chevron${open ? ' is-open' : ''}`} />
      </button>

      {open && (
        <ul
          className="language-select-menu"
          role="listbox"
          aria-label={t('language.selectTooltip')}
        >
          {LANGUAGES.map((lang) => (
            <li key={lang}>
              <button
                type="button"
                role="option"
                aria-selected={lang === language}
                className={`language-select-option${lang === language ? ' is-selected' : ''}`}
                onClick={() => {
                  setLanguage(lang);
                  setOpen(false);
                }}
              >
                {optionLabel(lang)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
