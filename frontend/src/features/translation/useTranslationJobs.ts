import { useContext } from 'react';
import { TranslationJobsContext } from './translationJobsContextValue';
import type { TranslationJobsContextValue } from './translationJobsContextValue';

export function useTranslationJobs(): TranslationJobsContextValue {
  const ctx = useContext(TranslationJobsContext);
  if (!ctx) throw new Error('useTranslationJobs must be used within TranslationJobsProvider');
  return ctx;
}
