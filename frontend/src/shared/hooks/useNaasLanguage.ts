import { useEffect, useState } from 'react';
import i18n from '../i18n';

// Trimmed to English/Japanese — the two the frontend's own UI (shared/i18n/)
// actually has translations for, now that this selector also drives the
// UI's language (see the effect below), not just the agent's reply
// language. The naas-mcp agent-backend's own "switch to X" heuristic still
// accepts any plain language name mid-conversation (unaffected there) —
// this is purely the preset list the dropdown offers.
export type Language = 'English' | 'Japanese';
export const LANGUAGES: Language[] = ['English', 'Japanese'];

// i18next locale codes for each Language value.
const I18N_LOCALES: Record<Language, string> = {
  English: 'en',
  Japanese: 'ja',
};

const STORAGE_KEY = 'naas-agent-language';

function getInitialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  return (LANGUAGES as string[]).includes(stored ?? '') ? (stored as Language) : 'English';
}

/**
 * Plain hook (not a Context/Provider) — aihub's own theme system is already
 * a global app-wide Context-free flip of a `data-theme` attribute, and this
 * mirrors that same "one localStorage-backed value, no provider needed"
 * shape rather than the standalone naas app's original LanguageContext.
 * Each screen that needs it (NaasChatScreen, NaasAgentScreen) calls this
 * independently; both read/write the same localStorage key and i18n
 * instance, so they stay in sync across a full page navigation the same
 * way the old Context-backed value did — the only difference is there's no
 * live cross-component sync within a single render tree, which neither
 * screen ever needed simultaneously (only one is ever mounted at a time).
 */
export function useNaasLanguage(): [Language, (language: Language) => void] {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  // Syncs the frontend's own UI text to match — runs on mount too (not
  // just on change), so a language restored from localStorage on reload
  // takes effect immediately rather than waiting for the user to
  // re-select it.
  useEffect(() => {
    void i18n.changeLanguage(I18N_LOCALES[language]);
  }, [language]);

  return [language, setLanguageState];
}
