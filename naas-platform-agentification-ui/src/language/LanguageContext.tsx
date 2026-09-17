import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import i18n from '../i18n';

// Trimmed to English/Japanese — the two the frontend's own UI (i18n/)
// actually has translations for, now that this selector also drives the
// UI's language (see the effect below), not just the agent's reply
// language. agent-backend's core/language.py itself still accepts any
// plain language name for the mid-conversation "switch to X" heuristic
// (unaffected, unrestricted there) — this is purely the preset list this
// dropdown offers.
export type Language = 'English' | 'Japanese';
export const LANGUAGES: Language[] = ['English', 'Japanese'];

// i18next locale codes for each Language value.
const I18N_LOCALES: Record<Language, string> = {
  English: 'en',
  Japanese: 'ja',
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

// Mirrors theme/ThemeContext.tsx's localStorage + Context pattern. Unlike
// theme, there's no DOM attribute to set — this value isn't read by any
// CSS; ChatPanel.tsx reads it on every turn and (re-)sends it to
// agent-backend whenever it's changed since the last turn that actually
// sent it, so switching this mid-conversation takes effect on the next
// message rather than only ever seeding the session's first one (see
// api/client.ts's postChatStream and core/runtime.py's stream_turn). Also
// drives the frontend's OWN static UI text (i18n/, via i18n.changeLanguage
// below) — one selector, two independent effects: this app's own labels/
// headings/buttons switch immediately (no backend round-trip), while the
// agent's chat replies switch on the next turn sent, per the above. Live
// data from tool_results/API responses and the agent's own reply text are
// never touched by either.
const STORAGE_KEY = 'naas-agent-language';

function getInitialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  return (LANGUAGES as string[]).includes(stored ?? '') ? (stored as Language) : 'English';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);

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

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
