import { SentenceTranslationDtoSchema, SentenceTranslationRequestSchema } from '@context-reader/contracts';

import { apiRequest } from './client';

// Include the server's 120-second generation deadline plus cold-start/network time.
export const SENTENCE_TRANSLATION_TIMEOUT_MS = 150_000;

export async function requestSentenceTranslation(text: string): Promise<string> {
  const result = await apiRequest('/v1/sentence-translations', SentenceTranslationDtoSchema, {
    method: 'POST',
    body: JSON.stringify(SentenceTranslationRequestSchema.parse({ text })),
  }, SENTENCE_TRANSLATION_TIMEOUT_MS);
  return result.translatedTextZh;
}
