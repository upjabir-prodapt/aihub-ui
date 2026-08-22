import { createContext } from 'react';
import type { useTranslation as useTranslationJobsHook } from '../hooks/useTranslation';

export type TranslationJobsContextValue = ReturnType<typeof useTranslationJobsHook>;

export const TranslationJobsContext = createContext<TranslationJobsContextValue | null>(null);
