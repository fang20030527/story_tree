import { randomBytes, randomUUID } from 'node:crypto';

import {
  AnonymousAuthResponseSchema,
  AnswerResultSchema,
  AssistanceResponseSchema,
  CreatePracticeAcceptedSchema,
  DashboardDtoSchema,
  PracticeDtoSchema,
  PublicErrorSchema,
  TranslationDtoSchema,
  VocabularyPageSchema,
  type PracticeDto,
  type TranslationDto,
  type VocabularyPage,
} from '@context-reader/contracts';
import type { ZodType } from 'zod';

const MAX_POLL_MS = 120_000;
const CHINESE_CHARACTER = /[\u3400-\u9fff]/u;
const PRACTICE_ITEMS = [
  { term: 'resilient', meaningZh: '有韧性的' },
  { term: 'ambiguous', meaningZh: '模棱两可的' },
  { term: 'meticulous', meaningZh: '一丝不苟的' },
] as const;

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  method?: 'GET' | 'POST';
}

type ApiRequest = <T>(
  path: string,
  schema: ZodType<T>,
  options?: RequestOptions,
) => Promise<T>;

function requireLiveOptIn(): void {
  if (process.env.RUN_LIVE_SMOKE !== '1') {
    throw new Error('Live smoke disabled; set RUN_LIVE_SMOKE=1 to opt in');
  }
}

function resolveApiBaseUrl(): string {
  const candidate = process.env.EXPO_PUBLIC_API_BASE_URL
    ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
  try {
    return new URL(candidate).toString().replace(/\/$/, '');
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is invalid');
  }
}

function createApiRequest(baseUrl: string, token: string): ApiRequest {
  return async <T>(
    path: string,
    schema: ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> => {
    const headers = new Headers({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new Error('Network request failed');
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error(`Request returned non-JSON status=${response.status}`);
    }

    if (!response.ok) {
      const publicError = PublicErrorSchema.safeParse(json);
      const code = publicError.success
        ? publicError.data.error.code
        : 'INVALID_ERROR_RESPONSE';
      throw new Error(`Request failed status=${response.status} code=${code}`);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error('Request returned an invalid payload');
    return parsed.data;
  };
}

function idempotencyKey(): string {
  return randomUUID();
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nextPollDelay(value: number | undefined, resource: string): number {
  if (!value) throw new Error(`${resource} omitted pollAfterMs`);
  return value;
}

async function waitForPractice(
  request: ApiRequest,
  practiceId: string,
  initialDelayMs: number | undefined,
): Promise<PracticeDto> {
  const deadlineAt = Date.now() + MAX_POLL_MS;
  let delayMs = nextPollDelay(initialDelayMs, 'Practice');

  while (Date.now() + delayMs <= deadlineAt) {
    await pause(delayMs);
    const practice = await request(
      `/v1/practices/${encodeURIComponent(practiceId)}`,
      PracticeDtoSchema,
    );
    if (
      practice.status === 'ready'
      || practice.status === 'in_progress'
      || practice.status === 'completed'
    ) {
      return practice;
    }
    if (practice.status === 'failed') {
      throw new Error(`Practice failed code=${practice.failure?.code ?? 'UNKNOWN'}`);
    }
    delayMs = nextPollDelay(practice.pollAfterMs, 'Practice');
  }

  throw new Error('Practice polling exceeded 120000ms');
}

async function waitForTranslation(
  request: ApiRequest,
  initial: TranslationDto,
): Promise<TranslationDto> {
  if (initial.status === 'ready') return initial;
  if (initial.status === 'failed') {
    throw new Error(`Translation failed code=${initial.failure?.code ?? 'UNKNOWN'}`);
  }

  const deadlineAt = Date.now() + MAX_POLL_MS;
  let delayMs = nextPollDelay(initial.pollAfterMs, 'Translation');
  while (Date.now() + delayMs <= deadlineAt) {
    await pause(delayMs);
    const translation = await request(
      `/v1/translations/${encodeURIComponent(initial.id)}`,
      TranslationDtoSchema,
    );
    if (translation.status === 'ready') return translation;
    if (translation.status === 'failed') {
      throw new Error(
        `Translation failed code=${translation.failure?.code ?? 'UNKNOWN'}`,
      );
    }
    delayMs = nextPollDelay(translation.pollAfterMs, 'Translation');
  }

  throw new Error('Translation polling exceeded 120000ms');
}

function requireChineseTranslation(translation: TranslationDto): string {
  const text = translation.translatedTextZh?.trim();
  if (!text || !CHINESE_CHARACTER.test(text)) {
    throw new Error('Translation did not contain non-empty Chinese text');
  }
  return text;
}

function assertGeneratedTargets(practice: PracticeDto): void {
  if (!practice.article) throw new Error('Ready practice omitted its article');
  const expectedTerms = new Set(PRACTICE_ITEMS.map((item) => item.term));
  const questionsByTerm = new Map(
    practice.questions.map((question) => [question.term.toLowerCase(), question]),
  );
  for (const term of expectedTerms) {
    if (!questionsByTerm.has(term)) throw new Error('Practice omitted a target');
  }

  const renderedTargets = new Set(
    practice.article.paragraphs.flatMap((paragraph) =>
      paragraph.segments.flatMap((segment) =>
        segment.targetId ? [segment.targetId] : [],
      ),
    ),
  );
  for (const question of practice.questions) {
    if (!renderedTargets.has(question.targetId)) {
      throw new Error('Article omitted a target highlight');
    }
  }
}

function assertSameReplay(left: unknown, right: unknown, resource: string): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`${resource} idempotent replay changed its result`);
  }
}

function progressSnapshot(page: VocabularyPage): string {
  return JSON.stringify(
    page.items
      .map((item) => ({
        assistedCount: item.assistedCount,
        firstTryCorrectCount: item.firstTryCorrectCount,
        id: item.id,
        practiceCount: item.practiceCount,
        status: item.status,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

async function getProgressSnapshot(request: ApiRequest): Promise<string> {
  const page = await request(
    '/v1/vocabulary-items?limit=50',
    VocabularyPageSchema,
  );
  return progressSnapshot(page);
}

async function requestReadyTranslation(
  request: ApiRequest,
  practiceId: string,
  body: { scope: 'full' } | { scope: 'paragraph'; paragraphId: string },
): Promise<TranslationDto> {
  const key = idempotencyKey();
  const initial = await request(
    `/v1/practices/${encodeURIComponent(practiceId)}/translations`,
    TranslationDtoSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  const replay = await request(
    `/v1/practices/${encodeURIComponent(practiceId)}/translations`,
    TranslationDtoSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  if (initial.id !== replay.id) {
    throw new Error('Translation idempotent replay changed its resource ID');
  }
  return waitForTranslation(request, initial);
}

async function recordAssistanceWithReplay(
  request: ApiRequest,
  practiceId: string,
  body:
    | { kind: 'full_translation' }
    | { kind: 'paragraph_translation'; paragraphId: string },
): Promise<void> {
  const key = idempotencyKey();
  const recorded = await request(
    `/v1/practices/${encodeURIComponent(practiceId)}/assistance`,
    AssistanceResponseSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  const beforeReplay = await getProgressSnapshot(request);
  const replay = await request(
    `/v1/practices/${encodeURIComponent(practiceId)}/assistance`,
    AssistanceResponseSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  assertSameReplay(recorded, replay, 'Assistance');
  const afterReplay = await getProgressSnapshot(request);
  if (beforeReplay !== afterReplay) {
    throw new Error('Assistance replay changed progress counts');
  }
}

async function submitAnswerWithReplay(
  request: ApiRequest,
  practiceId: string,
  body:
    | {
        answerKind: 'option';
        questionId: string;
        selectedOptionId: string;
        elapsedMs: number;
      }
    | {
        answerKind: 'dont_know';
        questionId: string;
        elapsedMs: number;
      },
): Promise<{ isCorrect: boolean }> {
  const key = idempotencyKey();
  const answer = await request(
    `/v1/practices/${encodeURIComponent(practiceId)}/answers`,
    AnswerResultSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  const beforeReplay = await getProgressSnapshot(request);
  const replay = await request(
    `/v1/practices/${encodeURIComponent(practiceId)}/answers`,
    AnswerResultSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  assertSameReplay(answer, replay, 'Answer');
  const afterReplay = await getProgressSnapshot(request);
  if (beforeReplay !== afterReplay) {
    throw new Error('Answer replay changed progress counts');
  }
  return answer;
}

async function runLiveSmoke(): Promise<void> {
  requireLiveOptIn();
  const startedAt = Date.now();
  const request = createApiRequest(
    resolveApiBaseUrl(),
    randomBytes(32).toString('hex'),
  );

  const auth = await request(
    '/v1/auth/anonymous',
    AnonymousAuthResponseSchema,
    { method: 'POST', body: { ageConfirmed14Plus: true } },
  );
  process.stdout.write(
    `auth userId=${auth.userId} remainingFreePractices=${auth.remainingFreePractices}\n`,
  );

  const createKey = idempotencyKey();
  const createBody = { items: PRACTICE_ITEMS };
  const created = await request(
    '/v1/practices',
    CreatePracticeAcceptedSchema,
    { method: 'POST', body: createBody, idempotencyKey: createKey },
  );
  const createReplay = await request(
    '/v1/practices',
    CreatePracticeAcceptedSchema,
    { method: 'POST', body: createBody, idempotencyKey: createKey },
  );
  if (
    created.practiceId !== createReplay.practiceId
    || created.remainingFreePractices !== createReplay.remainingFreePractices
  ) {
    throw new Error('Practice replay changed its ID or remaining quota');
  }

  const practice = await waitForPractice(
    request,
    created.practiceId,
    created.pollAfterMs,
  );
  assertGeneratedTargets(practice);
  process.stdout.write(
    `practice id=${practice.id} status=${practice.status} targets=${practice.questions.length} model=${practice.modelName ?? 'unknown'} remainingFreePractices=${practice.remainingFreePractices} elapsedMs=${Date.now() - startedAt}\n`,
  );

  const firstParagraph = practice.article?.paragraphs[0];
  if (!firstParagraph) throw new Error('Ready practice omitted its first paragraph');
  const paragraphTranslation = await requestReadyTranslation(
    request,
    practice.id,
    { scope: 'paragraph', paragraphId: firstParagraph.id },
  );
  const paragraphText = requireChineseTranslation(paragraphTranslation);
  await recordAssistanceWithReplay(
    request,
    practice.id,
    { kind: 'paragraph_translation', paragraphId: firstParagraph.id },
  );
  process.stdout.write(
    `translation id=${paragraphTranslation.id} status=${paragraphTranslation.status} scope=paragraph characters=${paragraphText.length} elapsedMs=${Date.now() - startedAt}\n`,
  );

  const fullTranslation = await requestReadyTranslation(
    request,
    practice.id,
    { scope: 'full' },
  );
  const fullText = requireChineseTranslation(fullTranslation);
  await recordAssistanceWithReplay(
    request,
    practice.id,
    { kind: 'full_translation' },
  );
  process.stdout.write(
    `translation id=${fullTranslation.id} status=${fullTranslation.status} scope=full characters=${fullText.length} elapsedMs=${Date.now() - startedAt}\n`,
  );

  const meaningByTerm = new Map<string, string>(
    PRACTICE_ITEMS.map((item) => [item.term, item.meaningZh]),
  );
  const correctQuestion = practice.questions.find((question) => {
    const meaning = meaningByTerm.get(question.term.toLowerCase());
    return meaning && question.options.some((option) => option.label === meaning);
  });
  if (!correctQuestion) throw new Error('No guaranteed-correct question was found');
  const correctMeaning = meaningByTerm.get(correctQuestion.term.toLowerCase());
  const correctOption = correctQuestion.options.find(
    (option) => option.label === correctMeaning,
  );
  if (!correctOption) throw new Error('No guaranteed-correct option was found');

  const correctAnswer = await submitAnswerWithReplay(
    request,
    practice.id,
    {
      answerKind: 'option',
      questionId: correctQuestion.id,
      selectedOptionId: correctOption.id,
      elapsedMs: 1_000,
    },
  );
  if (!correctAnswer.isCorrect) throw new Error('Guaranteed-correct answer was rejected');

  const incorrectQuestion = practice.questions.find(
    (question) => question.id !== correctQuestion.id,
  );
  if (!incorrectQuestion) throw new Error('No second question was found');
  const incorrectAnswer = await submitAnswerWithReplay(
    request,
    practice.id,
    {
      answerKind: 'dont_know',
      questionId: incorrectQuestion.id,
      elapsedMs: 1_000,
    },
  );
  if (incorrectAnswer.isCorrect) throw new Error('Dont-know answer was marked correct');

  const vocabulary = await request(
    '/v1/vocabulary-items?limit=50',
    VocabularyPageSchema,
  );
  const dashboard = await request('/v1/dashboard', DashboardDtoSchema);
  if (dashboard.remainingFreePractices !== created.remainingFreePractices) {
    throw new Error('Idempotent replay changed remaining quota');
  }
  process.stdout.write(
    `answers total=2 correct=1 incorrect=1 vocabulary=${vocabulary.items.length} remainingFreePractices=${dashboard.remainingFreePractices} elapsedMs=${Date.now() - startedAt}\n`,
  );
}

runLiveSmoke().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Live smoke failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
