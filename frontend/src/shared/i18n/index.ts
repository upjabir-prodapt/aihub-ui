import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ja from './locales/ja.json';

// UI-chrome translations (buttons, headings, table headers, empty states)
// — deliberately separate from language/LanguageContext.tsx, which
// controls the AGENT's own chat-reply language via a server-side
// translation call (core/language.py). The two are bridged in
// LanguageContext.tsx (its Language 'English'/'Japanese' values map to
// i18next's 'en'/'ja' locale codes, switching this whenever that
// selector changes) so one dropdown drives both, but they're otherwise
// independent: this only ever affects static UI text, never anything
// sent to or received from the backend/agent.
//
// Never translated by this layer (left English regardless of locale, by
// deliberate scope decision — see the per-component comments where each
// applies): live data from tool_results/API responses (circuit names,
// statuses, numbers), the agent's own reply text, and the "simulated
// user message" templates picker components send when a row is clicked
// (e.g. "I'll check circuit #3: ...") — those are literal chat input the
// backend's prompts resolve by exact phrasing, not just display text.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already escapes — avoid double-escaping/breaking Japanese punctuation.
  },
});

export default i18n;
