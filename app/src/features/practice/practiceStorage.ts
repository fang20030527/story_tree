import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CreatePracticeRequestSchema,
  UuidSchema,
  type CreatePracticeWithItemsRequest,
  type CreatePracticeRequest,
} from '@context-reader/contracts';
import { z } from 'zod';

import { createIdempotencyKey } from '@/api/installation';
import {
  ACTIVE_PRACTICE_ID_KEY,
  AGE_CONFIRMED_KEY,
  CREATE_PRACTICE_OPERATION_KEY,
  PRACTICE_DRAFT_KEY,
  READING_POSITION_KEY_PREFIX,
} from '@/api/storage';

import type { VocabularyDraftRow } from './practiceDraft';

const VocabularyDraftSchema = z
  .array(
    z
      .object({
        term: z.string(),
        meaningZh: z.string(),
        sourceSentence: z.string(),
      })
      .strict(),
  )
  .min(1)
  .max(10);

const CreatePracticeOperationSchema = z
  .object({
    request: CreatePracticeRequestSchema,
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  })
  .strict();

export interface CreatePracticeOperation {
  request: CreatePracticeRequest;
  idempotencyKey: string;
}

export class PendingCreateOperationError extends Error {
  readonly code = 'CREATE_OPERATION_PENDING';

  constructor() {
    super('已有一次创建请求尚未确认，请先使用原内容重试');
    this.name = 'PendingCreateOperationError';
  }
}

export const EMPTY_VOCABULARY_DRAFT: VocabularyDraftRow[] = [
  { term: '', meaningZh: '', sourceSentence: '' },
];

function parseStoredJson<T>(
  serialized: string | null,
  schema: z.ZodType<T>,
): T | null {
  if (!serialized) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function requestToVocabularyDraft(
  request: CreatePracticeWithItemsRequest,
): VocabularyDraftRow[] {
  return request.items.map((item) => ({
    term: item.term,
    meaningZh: item.meaningZh,
    sourceSentence: item.sourceSentence ?? '',
  }));
}

function requestsMatch(
  left: CreatePracticeRequest,
  right: CreatePracticeRequest,
): boolean {
  // Resume an older pending request with its original key and payload after an app update.
  const comparableRight = left.format === undefined && right.format === 'topic_set'
    ? Object.fromEntries(Object.entries(right).filter(([key]) => key !== 'format'))
    : right;
  return JSON.stringify(left) === JSON.stringify(comparableRight);
}

export async function loadVocabularyDraft(): Promise<VocabularyDraftRow[]> {
  const stored = await AsyncStorage.getItem(PRACTICE_DRAFT_KEY);
  return parseStoredJson(stored, VocabularyDraftSchema)
    ?? EMPTY_VOCABULARY_DRAFT.map((row) => ({ ...row }));
}

export function saveVocabularyDraft(
  rows: VocabularyDraftRow[],
): Promise<void> {
  return AsyncStorage.setItem(PRACTICE_DRAFT_KEY, JSON.stringify(rows));
}

export async function hasConfirmedAge(): Promise<boolean> {
  return (await AsyncStorage.getItem(AGE_CONFIRMED_KEY)) === 'true';
}

export function saveAgeConfirmation(): Promise<void> {
  return AsyncStorage.setItem(AGE_CONFIRMED_KEY, 'true');
}

export async function loadCreatePracticeOperation(): Promise<
  CreatePracticeOperation | null
> {
  const stored = await AsyncStorage.getItem(CREATE_PRACTICE_OPERATION_KEY);
  return parseStoredJson(stored, CreatePracticeOperationSchema);
}

export async function prepareCreatePracticeOperation(
  request: CreatePracticeRequest,
): Promise<CreatePracticeOperation> {
  const existing = await loadCreatePracticeOperation();
  if (existing) {
    if (requestsMatch(existing.request, request)) return existing;
    throw new PendingCreateOperationError();
  }

  const operation = {
    request,
    idempotencyKey: await createIdempotencyKey(),
  };
  if ('items' in request) {
    await AsyncStorage.multiSet([
      [PRACTICE_DRAFT_KEY, JSON.stringify(requestToVocabularyDraft(request))],
      [CREATE_PRACTICE_OPERATION_KEY, JSON.stringify(operation)],
    ]);
  } else {
    await AsyncStorage.setItem(
      CREATE_PRACTICE_OPERATION_KEY,
      JSON.stringify(operation),
    );
  }
  return operation;
}

export function saveActivePracticeId(practiceId: string): Promise<void> {
  const parsedId = UuidSchema.parse(practiceId);
  return AsyncStorage.setItem(ACTIVE_PRACTICE_ID_KEY, parsedId);
}

export async function loadActivePracticeId(): Promise<string | null> {
  const stored = await AsyncStorage.getItem(ACTIVE_PRACTICE_ID_KEY);
  const parsed = UuidSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export function clearActivePracticeId(): Promise<void> {
  return AsyncStorage.removeItem(ACTIVE_PRACTICE_ID_KEY);
}

export function clearCreatePracticeOperation(): Promise<void> {
  return AsyncStorage.removeItem(CREATE_PRACTICE_OPERATION_KEY);
}

export async function clearReadyPracticeCreation(): Promise<void> {
  const operation = await loadCreatePracticeOperation();
  if (!operation || 'source' in operation.request) {
    await AsyncStorage.removeItem(CREATE_PRACTICE_OPERATION_KEY);
    return;
  }
  await AsyncStorage.multiRemove([
    PRACTICE_DRAFT_KEY,
    CREATE_PRACTICE_OPERATION_KEY,
  ]);
}

function readingPositionKey(practiceId: string): string {
  return `${READING_POSITION_KEY_PREFIX}${UuidSchema.parse(practiceId)}`;
}

export function saveReadingPosition(
  practiceId: string,
  paragraphIndex: number,
): Promise<void> {
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) {
    return Promise.reject(new Error('Invalid reading position'));
  }
  return AsyncStorage.setItem(
    readingPositionKey(practiceId),
    String(paragraphIndex),
  );
}

export async function loadReadingPosition(practiceId: string): Promise<number> {
  const stored = await AsyncStorage.getItem(readingPositionKey(practiceId));
  const index = Number(stored);
  return Number.isSafeInteger(index) && index >= 0 ? index : 0;
}
