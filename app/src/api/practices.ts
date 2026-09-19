import {
  AnonymousAuthResponseSchema,
  type AnonymousAuthResponse,
  AnswerResultSchema,
  type AnswerResult,
  AssistanceResponseSchema,
  type AssistanceRequest,
  type AssistanceResponse,
  CreatePracticeAcceptedSchema,
  type CreatePracticeAccepted,
  type CreatePracticeRequest,
  DashboardDtoSchema,
  type DashboardDto,
  PracticeDtoSchema,
  type PracticeDto,
  type SubmitAnswerRequest,
  TranslationDtoSchema,
  type TranslationDto,
  type TranslationRequest,
  VocabularyInputSchema,
  type VocabularyInput,
  VocabularyItemDtoSchema,
  type VocabularyItemDto,
  type WordTranslationDto,
  type WordTranslationRequest,
  VocabularyPageSchema,
  type VocabularyPage,
  VocabularyWordPageSchema,
  type VocabularyWordPage,
  type VocabularyWordFilter,
  VocabularyWordContextsSchema,
  type VocabularyWordContexts,
  VocabularyWordMasterySchema,
  type VocabularyWordMastery,
} from '@context-reader/contracts';
import type { ZodType } from 'zod';

import { lookupLocalWord } from '@/features/dictionary/lookup';

import { apiRequest } from './client';

function postIdempotentJson<T>(
  path: string,
  schema: ZodType<T>,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return apiRequest(path, schema, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
}

export function registerAnonymous(
  ageConfirmed14Plus: true,
): Promise<AnonymousAuthResponse> {
  return apiRequest('/v1/auth/anonymous', AnonymousAuthResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ ageConfirmed14Plus }),
  });
}

export function createPractice(
  request: CreatePracticeRequest,
  idempotencyKey: string,
): Promise<CreatePracticeAccepted> {
  return postIdempotentJson(
    '/v1/practices',
    CreatePracticeAcceptedSchema,
    request,
    idempotencyKey,
  );
}

export function getPractice(practiceId: string): Promise<PracticeDto> {
  return apiRequest(
    `/v1/practices/${encodeURIComponent(practiceId)}`,
    PracticeDtoSchema,
  );
}

export function requestTranslation(
  practiceId: string,
  request: TranslationRequest,
  idempotencyKey: string,
): Promise<TranslationDto> {
  return postIdempotentJson(
    `/v1/practices/${encodeURIComponent(practiceId)}/translations`,
    TranslationDtoSchema,
    request,
    idempotencyKey,
  );
}

export function getTranslation(translationId: string): Promise<TranslationDto> {
  return apiRequest(
    `/v1/translations/${encodeURIComponent(translationId)}`,
    TranslationDtoSchema,
  );
}

export function recordAssistance(
  practiceId: string,
  request: AssistanceRequest,
  idempotencyKey: string,
): Promise<AssistanceResponse> {
  return postIdempotentJson(
    `/v1/practices/${encodeURIComponent(practiceId)}/assistance`,
    AssistanceResponseSchema,
    request,
    idempotencyKey,
  );
}

/** 查随应用打包的本地词典，保留旧入口供阅读页共用，不发送翻译请求。 */
export function requestWordTranslation(
  request: WordTranslationRequest,
): Promise<WordTranslationDto> {
  return lookupLocalWord(request);
}

/** Add a contextual word/phrase to the durable vocabulary. */
export function createVocabularyItem(
  request: VocabularyInput,
  idempotencyKey: string,
): Promise<VocabularyItemDto> {
  return postIdempotentJson(
    '/v1/vocabulary-items',
    VocabularyItemDtoSchema,
    VocabularyInputSchema.parse(request),
    idempotencyKey,
  );
}

export function submitAnswer(
  practiceId: string,
  request: SubmitAnswerRequest,
  idempotencyKey: string,
): Promise<AnswerResult> {
  return postIdempotentJson(
    `/v1/practices/${encodeURIComponent(practiceId)}/answers`,
    AnswerResultSchema,
    request,
    idempotencyKey,
  );
}

export interface VocabularyPageOptions {
  cursor?: string;
  limit?: number;
}

export function getVocabulary(
  options: VocabularyPageOptions = {},
): Promise<VocabularyPage> {
  const query = new URLSearchParams();
  if (options.cursor !== undefined) query.set('cursor', options.cursor);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const serializedQuery = query.toString();
  const suffix = serializedQuery ? `?${serializedQuery}` : '';

  return apiRequest(
    `/v1/vocabulary-items${suffix}`,
    VocabularyPageSchema,
  );
}

export function getDashboard(): Promise<DashboardDto> {
  const query = new URLSearchParams({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return apiRequest(`/v1/dashboard?${query.toString()}`, DashboardDtoSchema);
}

export interface VocabularyWordPageOptions extends VocabularyPageOptions {
  filter?: VocabularyWordFilter;
  /** IANA time zone used by the server to compute the local "today" filter. */
  timeZone?: string;
}

export function getVocabularyWords(
  options: VocabularyWordPageOptions = {},
): Promise<VocabularyWordPage> {
  const query = new URLSearchParams();
  if (options.filter !== undefined) query.set('filter', options.filter);
  if (options.timeZone !== undefined) query.set('timeZone', options.timeZone);
  if (options.cursor !== undefined) query.set('cursor', options.cursor);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const serializedQuery = query.toString();
  return apiRequest(
    `/v1/vocabulary-words${serializedQuery ? `?${serializedQuery}` : ''}`,
    VocabularyWordPageSchema,
  );
}

/** Mark a word as manually mastered so it leaves future auto selection. */
export function markVocabularyWordMastered(
  wordId: string,
  idempotencyKey: string,
): Promise<VocabularyWordMastery> {
  return postIdempotentJson(
    `/v1/vocabulary-words/${encodeURIComponent(wordId)}/mastered`,
    VocabularyWordMasterySchema,
    {},
    idempotencyKey,
  );
}

/** Restore a mastered word to learning without touching its review evidence. */
export function restoreVocabularyWord(
  wordId: string,
  idempotencyKey: string,
): Promise<VocabularyWordMastery> {
  return postIdempotentJson(
    `/v1/vocabulary-words/${encodeURIComponent(wordId)}/unmaster`,
    VocabularyWordMasterySchema,
    {},
    idempotencyKey,
  );
}

export function getVocabularyWordContexts(
  wordId: string,
): Promise<VocabularyWordContexts> {
  return apiRequest(
    `/v1/vocabulary-words/${encodeURIComponent(wordId)}/contexts`,
    VocabularyWordContextsSchema,
  );
}
