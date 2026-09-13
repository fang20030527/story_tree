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
  WordTranslationDtoSchema,
  type WordTranslationDto,
  type WordTranslationRequest,
  VocabularyPageSchema,
  type VocabularyPage,
} from '@context-reader/contracts';
import type { ZodType } from 'zod';

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

/** Translate one selected word/phrase in the context supplied by the reader. */
export function requestWordTranslation(
  request: WordTranslationRequest,
): Promise<WordTranslationDto> {
  return apiRequest('/v1/word-translations', WordTranslationDtoSchema, {
    method: 'POST',
    body: JSON.stringify(request),
  });
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
  return apiRequest('/v1/dashboard', DashboardDtoSchema);
}
