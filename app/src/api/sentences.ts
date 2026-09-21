import { SentenceTranslationDtoSchema, SentenceTranslationRequestSchema } from '@context-reader/contracts';

import { apiRequest } from './client';

export async function requestSentenceTranslation(text: string): Promise<string> {
  const result = await apiRequest('/v1/sentence-translations', SentenceTranslationDtoSchema, {
    method: 'POST',
    body: JSON.stringify(SentenceTranslationRequestSchema.parse({ text })),
  });
  return result.translatedTextZh;
}
