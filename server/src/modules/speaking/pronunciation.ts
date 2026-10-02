import {
  SpeakingPronunciationAssessmentDtoSchema, SpeakingAiCoachingResultSchema,
  type CreateSpeakingPronunciationRequest, type SpeakingPronunciationAssessmentDto,
} from '@context-reader/contracts';
import { and, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { AppError } from '../../core/errors';
import type { ServerConfig } from '../../config/env';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { speakingPronunciationAssessments as assessments, users } from '../../db/schema';
import { EvolinkPronunciationProvider } from '../../infrastructure/speech/evolink';
import type { PronunciationProvider } from '../../infrastructure/speech/provider';
import type { MediaStore } from '../../infrastructure/media/store';
import { beginIdempotentOperation, finishIdempotentOperation } from '../idempotency/service';
import { getOwnedSpeakingAsset } from './assets';
import { getSpeakingMaterial, type SpeakingDataDependencies } from './service';
import {
  assertPronunciationAsset, assertPronunciationReference, expiredPronunciationError,
  PRONUNCIATION_PROCESSING_TTL_MS, pronunciationFailure, pronunciationFingerprint,
} from './pronunciation-shared';

interface Dependencies extends SpeakingDataDependencies {
  config: ServerConfig; mediaStore: MediaStore | undefined; pronunciationProvider?: PronunciationProvider;
}
type Db = AppDatabase | AppTransaction;
type Assessment = typeof assessments.$inferSelect;
const OPERATION = 'create_speaking_pronunciation';

async function readAudio(store: MediaStore, storageKey: string, expectedBytes: number): Promise<Uint8Array> {
  let stream: Readable | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = () => new AppError('MEDIA_UNAVAILABLE', '录音暂时无法读取，请稍后重试', 503, true);
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { expired = true; stream?.destroy(); reject(unavailable()); }, 10_000);
  });
  const reading = (async () => {
    stream = await store.openRead(storageKey);
    if (expired) { stream.destroy(); throw unavailable(); }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for await (const chunk of stream) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(Buffer.from(chunk as string));
        length += bytes.byteLength;
        if (length > expectedBytes) throw new AppError('PRONUNCIATION_AUDIO_INVALID', '录音内容发生变化，请重新录制', 400);
        chunks.push(bytes);
      }
    } finally { stream.destroy(); }
    if (length !== expectedBytes) throw new AppError('PRONUNCIATION_AUDIO_INVALID', '录音内容不完整，请重新录制', 400);
    return Buffer.concat(chunks);
  })();
  try { return await Promise.race([reading, deadline]); }
  finally { clearTimeout(timer); }
}

function dto(record: Assessment): SpeakingPronunciationAssessmentDto {
  return SpeakingPronunciationAssessmentDtoSchema.parse({
    id: record.id, assetId: record.assetId, materialId: record.materialId, cueId: record.cueId,
    referenceText: record.referenceText, subtitleRevision: record.subtitleRevision, locale: record.locale,
    provider: record.provider, status: record.status, result: record.result, error: record.error,
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
  });
}
async function requireRegistered(db: Db, userId: string): Promise<void> {
  const [user] = await db.select({ kind: users.kind }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
  if (user?.kind !== 'registered') throw new AppError('UNAUTHORIZED', '请先登录后使用AI 口语点评', 401);
}
async function expire(db: Db, userId: string): Promise<void> {
  const now = new Date();
  await db.update(assessments).set({ status: 'failed', result: null, error: expiredPronunciationError(), updatedAt: now })
    .where(and(eq(assessments.userId, userId), eq(assessments.status, 'processing'), lte(assessments.deadlineAt, now)));
}
async function find(db: Db, userId: string, id: string): Promise<Assessment> {
  const [record] = await db.select().from(assessments).where(and(eq(assessments.id, id), eq(assessments.userId, userId))).limit(1);
  if (!record) throw new AppError('NOT_FOUND', '点评记录不存在', 404);
  return record;
}
export async function getSpeakingPronunciationAssessment(deps: Pick<Dependencies, 'db'>, userId: string, id: string) {
  await requireRegistered(deps.db, userId);
  await expire(deps.db, userId);
  return dto(await find(deps.db, userId, id));
}

export async function createSpeakingPronunciationAssessment(deps: Dependencies, userId: string, key: string,
  request: CreateSpeakingPronunciationRequest): Promise<SpeakingPronunciationAssessmentDto> {
  await requireRegistered(deps.db, userId);
  const fingerprint = await pronunciationFingerprint(request, deps.config.EVOLINK_AUDIO_MODEL);
  const reservation = await deps.db.transaction(async tx => {
    const previous = await beginIdempotentOperation(tx, userId, OPERATION, key, request);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`speaking-pronunciation:${userId}`}))`);
    await expire(tx, userId);
    if (previous) return { record: await find(tx, userId, previous), owned: false };
    const [cached] = await tx.select().from(assessments).where(and(eq(assessments.userId, userId),
      eq(assessments.fingerprint, fingerprint), inArray(assessments.status, ['processing', 'ready'])))
      .orderBy(desc(assessments.createdAt)).limit(1);
    if (cached) {
      await finishIdempotentOperation(tx, userId, OPERATION, key, cached.id);
      return { record: cached, owned: false };
    }
    if (!deps.pronunciationProvider && !deps.config.EVOLINK_API_KEY) {
      throw new AppError('PRONUNCIATION_NOT_CONFIGURED', 'AI 口语点评服务尚未开放，请稍后再试', 503);
    }
    if (!deps.mediaStore) throw new AppError('MEDIA_STORAGE_NOT_CONFIGURED', '录音存储暂时不可用', 503, true);
    const asset = await getOwnedSpeakingAsset(tx, userId, request.assetId);
    assertPronunciationAsset(asset);
    if (request.materialId !== null) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`speaking-state:${userId}:${request.materialId}`}))`);
      assertPronunciationReference(await getSpeakingMaterial(deps, userId, request.materialId, tx), request);
    }
    const now = new Date();
    const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(assessments)
      .where(and(eq(assessments.userId, userId), gte(assessments.createdAt, day)));
    if ((usage?.count ?? 0) >= deps.config.SPEAKING_COACH_DAILY_LIMIT) {
      throw new AppError('PRONUNCIATION_LIMIT_REACHED', '当日 AI 口语点评次数已达到上限，请稍后再练习', 429);
    }
    const [record] = await tx.insert(assessments).values({ userId, ...request, fingerprint, provider: 'evolink', createdAt: now, updatedAt: now,
      deadlineAt: new Date(now.getTime() + PRONUNCIATION_PROCESSING_TTL_MS) }).returning();
    if (!record) throw new AppError('DATABASE_UNAVAILABLE', '点评暂时无法保存，请重试', 503, true);
    await finishIdempotentOperation(tx, userId, OPERATION, key, record.id);
    return { record, owned: true };
  });
  if (!reservation.owned) return dto(reservation.record);
  const record = reservation.record;
  // 占有记录先落库；重放和另一个设备只读取 processing，不再次调用收费接口。
  try {
    const asset = await getOwnedSpeakingAsset(deps.db, userId, request.assetId);
    assertPronunciationAsset(asset);
    if (!asset.storageKey || !deps.mediaStore) throw new AppError('MEDIA_UNAVAILABLE', '录音暂时无法读取，请稍后重试', 503, true);
    const audio = await readAudio(deps.mediaStore, asset.storageKey, asset.byteSize);
    const current = await find(deps.db, userId, record.id);
    if (current.status !== 'processing') return dto(current);
    if (current.deadlineAt.getTime() <= Date.now()) throw new AppError('PRONUNCIATION_UPSTREAM_UNAVAILABLE', '本次点评已超时，请重试；录音已保留', 503, true);
    const provider = deps.pronunciationProvider ?? new EvolinkPronunciationProvider({ apiKey: deps.config.EVOLINK_API_KEY,
      baseUrl: deps.config.EVOLINK_BASE_URL, model: deps.config.EVOLINK_AUDIO_MODEL, timeoutMs: deps.config.EVOLINK_AUDIO_TIMEOUT_MS });
    const parsed = SpeakingAiCoachingResultSchema.safeParse(await provider.assess({
      audio, contentType: asset.contentType, referenceText: record.referenceText, locale: record.locale,
    }));
    if (!parsed.success) throw new AppError('PRONUNCIATION_INVALID_RESULT', '点评结果无效，请稍后重试', 502, true);
    const completedAt = new Date();
    await deps.db.update(assessments).set({ status: 'ready', result: parsed.data, error: null, updatedAt: completedAt })
      .where(and(eq(assessments.id, record.id), eq(assessments.status, 'processing'), gt(assessments.deadlineAt, completedAt)));
  } catch (error) {
    const completedAt = new Date();
    await deps.db.update(assessments).set({ status: 'failed', result: null, error: pronunciationFailure(error), updatedAt: completedAt })
      .where(and(eq(assessments.id, record.id), eq(assessments.status, 'processing'), gt(assessments.deadlineAt, completedAt)));
  }
  await expire(deps.db, userId);
  return dto(await find(deps.db, userId, record.id));
}
