import React from 'react';
import { AuthProvider } from '../features/auth/AuthProvider';
import { TranslationJobsProvider } from '../features/translation/TranslationJobsContext';
import { SalesJobsProvider } from '../features/sales/SalesJobsContext';

/**
 * Every provider that must outlive navigation.
 *
 * **This nesting is load-bearing.** `TranslationJobsProvider` and
 * `SalesJobsProvider` mount *above* the router outlet, so a running translation
 * or research job keeps polling when the user moves between `/translation`,
 * `/sales` and `/tracker`. The previous shell achieved the same thing by keeping
 * every page mounted with `display: none`; the router replaced that, and if
 * these providers were ever moved inside a route element, navigating away would
 * unmount them and silently kill in-flight jobs.
 *
 * The accepted regression: page-local UI state (form fields, scroll position,
 * an open modal) is now lost on navigation, where the old pane-hiding approach
 * preserved it. That trade buys real URLs, which post-sign-in `return_to`
 * needs. Recorded in `memory-bank/`.
 */
export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>
    <TranslationJobsProvider>
      <SalesJobsProvider>{children}</SalesJobsProvider>
    </TranslationJobsProvider>
  </AuthProvider>
);
