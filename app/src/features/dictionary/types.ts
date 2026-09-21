import type { WordTranslationResult } from '@context-reader/contracts';

export type DictionaryEntry = WordTranslationResult & { baseTerm?: string };
export type DictionaryShard = Readonly<Record<string, DictionaryEntry | string>>;
