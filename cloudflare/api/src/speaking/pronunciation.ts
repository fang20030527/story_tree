import {
  SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES,
  SpeakingPronunciationAssessmentDtoSchema, SpeakingAiCoachingResultSchema, UuidSchema,
  type CreateSpeakingPronunciationRequest, type SpeakingMaterialDto,
  type SpeakingPronunciationAssessmentDto, type SpeakingPronunciationError,
  type SpeakingPronunciationResult,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { assertAiAvailable, consumeAiCall } from '../ai/budget';
import { EvolinkPronunciationProvider } from '../../../../server/src/infrastructure/speech/evolink';
import type { PronunciationProvider } from '../../../../server/src/infrastructure/speech/provider';
import {
  assertPronunciationAsset, assertPronunciationReference, expiredPronunciationError,
  pronunciationFailure, pronunciationFingerprint, pronunciationRequestFingerprint, PRONUNCIATION_PROCESSING_TTL_MS,
} from '../../../../server/src/modules/speaking/pronunciation-shared';
import { getEvolinkAudioSettings, type ApiEnv, type D1StatementBinding } from '../env';
import {
  findSpeakingIdempotency, getSpeakingAsset, getSpeakingMaterial, runSpeakingMutation,
  speakingFirst, speakingGuard, type SpeakingAssetRow,
} from './data';

const OPERATION = 'create_pronunciation';
const OWNED = 'EXISTS (SELECT 1 FROM speaking_idempotency WHERE id = ?)';
const RECORDING_READ_TIMEOUT_MS = 10_000;

interface AssessmentRow {
  id: string; user_id: string; asset_id: string; material_id: string | null; cue_id: string;
  reference_text: string; subtitle_revision: number | null; locale: 'en-us' | 'en-gb';
  fingerprint: string; status: 'processing' | 'ready' | 'failed';
  provider: 'speechace' | 'evolink';
  result_json: string | null; error_json: string | null;
  created_at: string; updated_at: string; deadline_at: string;
}

function dto(row: AssessmentRow): SpeakingPronunciationAssessmentDto {
  return SpeakingPronunciationAssessmentDtoSchema.parse({
    id: row.id, assetId: row.asset_id, materialId: row.material_id, cueId: row.cue_id,
    referenceText: row.reference_text, subtitleRevision: row.subtitle_revision,
    locale: row.locale, provider: row.provider, status: row.status,
    result: row.result_json === null ? null : JSON.parse(row.result_json) as unknown,
    error: row.error_json === null ? null : JSON.parse(row.error_json) as unknown,
    createdAt: row.created_at, updatedAt: row.updated_at,
  });
}

function databaseUnavailable() {
  return new AppError('DATABASE_UNAVAILABLE', '云端AI 口语点评暂时不可用，请稍后重试', 503, true);
}

async function expireAssessments(env: ApiEnv, userId: string) {
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`UPDATE speaking_pronunciation_assessments SET status = 'failed',
      error_json = ?, updated_at = ? WHERE user_id = ? AND status = 'processing' AND deadline_at <= ?`)
      .bind(JSON.stringify(expiredPronunciationError()), now, userId, now).run();
  } catch { throw databaseUnavailable(); }
}

async function requireRegisteredUser(env: ApiEnv, userId: string) {
  const user = await speakingFirst<{ kind: string }>(env,
    'SELECT kind FROM users WHERE id = ? AND deleted_at IS NULL', userId);
  if (user?.kind !== 'registered') throw new AppError('UNAUTHORIZED', '请先登录后再进行AI 口语点评', 401);
}

export async function getSpeakingPronunciationAssessment(env: ApiEnv, userId: string,
  id: string): Promise<SpeakingPronunciationAssessmentDto> {
  await requireRegisteredUser(env, userId);
  if (!UuidSchema.safeParse(id).success) throw new AppError('VALIDATION_ERROR', 'AI 口语点评编号格式无效', 400);
  await expireAssessments(env, userId);
  const row = await speakingFirst<AssessmentRow>(env,
    'SELECT * FROM speaking_pronunciation_assessments WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw new AppError('NOT_FOUND', 'AI 口语点评不存在', 404);
  return dto(row);
}

function utcDay(now: string): { start: string; end: string } {
  const start = `${now.slice(0, 10)}T00:00:00.000Z`;
  return { start, end: new Date(Date.parse(start) + 86_400_000).toISOString() };
}

async function dailyAttempts(env: ApiEnv, userId: string, now: string) {
  const day = utcDay(now);
  const count = await speakingFirst<{ total: number }>(env, `SELECT COUNT(*) AS total FROM speaking_pronunciation_assessments
    WHERE user_id = ? AND created_at >= ? AND created_at < ?`, userId, day.start, day.end);
  return count?.total ?? 0;
}

function quotaError() {
  return new AppError('PRONUNCIATION_LIMIT_REACHED', '今日AI 口语点评次数已用完，请明天继续练习', 429);
}

function referenceGuard(env: ApiEnv, recordId: string, userId: string,
  material: SpeakingMaterialDto | null): D1StatementBinding[] {
  if (!material) return [];
  if (material.sourceKind === 'platform') {
    return speakingGuard(env, recordId,
      'COALESCE((SELECT subtitle_revision FROM speaking_states WHERE user_id = ? AND material_id = ?), ?) = ?',
      [userId, material.id, material.revision, material.revision]);
  }
  return speakingGuard(env, recordId,
    'EXISTS (SELECT 1 FROM speaking_materials WHERE user_id = ? AND id = ? AND revision = ?)',
    [userId, material.id, material.revision]);
}

function normalizeAudioType(type: string) {
  return type === 'audio/mp3' ? 'audio/mpeg' : ['audio/x-m4a', 'audio/m4a'].includes(type) ? 'audio/mp4'
    : type === 'audio/x-wav' ? 'audio/wav' : type;
}

async function readRecording(env: ApiEnv, userId: string, asset: SpeakingAssetRow): Promise<Uint8Array> {
  if (!env.SPEAKING_BUCKET) throw new AppError('MEDIA_STORAGE_NOT_CONFIGURED', '口语媒体服务尚未配置', 503, true);
  if (asset.storage_key !== `users/${userId}/${asset.id}/source`) {
    throw new AppError('PRONUNCIATION_AUDIO_INVALID', '录音文件无效，请重新录制', 422);
  }
  const bucket = env.SPEAKING_BUCKET;
  const timeoutError = () => new AppError('MEDIA_UNAVAILABLE', '录音读取超时，请稍后重试', 503, true);
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const cancelReader = () => {
    const active = reader;
    if (!active) return;
    reader = null;
    // 取消操作也可能依赖阻塞的远端读取，不能 await 它延长整体 deadline。
    void active.cancel().catch(() => undefined);
    active.releaseLock();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      cancelReader();
      reject(timeoutError());
    }, RECORDING_READ_TIMEOUT_MS);
  });
  const read = async () => {
    const object = await bucket.get(asset.storage_key);
    // R2 get 没有 AbortSignal；超时后迟到的响应仍须释放它的内容流。
    if (timedOut) {
      if (object) void object.body.cancel().catch(() => undefined);
      throw timeoutError();
    }
    if (!object) throw new AppError('MEDIA_UNAVAILABLE', '录音暂时无法读取，请重新录制', 503, true);
    if (object.size !== asset.byte_size || object.size > SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES ||
      object.etag !== asset.etag || normalizeAudioType(object.httpMetadata?.contentType ?? '') !== normalizeAudioType(asset.content_type)) {
      void object.body.cancel().catch(() => undefined);
      throw new AppError('PRONUNCIATION_AUDIO_INVALID', '录音内容或大小已改变，请重新录制', 422);
    }
    const active = object.body.getReader();
    reader = active;
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await active.read();
        if (timedOut) throw timeoutError();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES || length > asset.byte_size) {
          cancelReader();
          throw new AppError('PRONUNCIATION_AUDIO_INVALID', '录音文件超过允许的大小，请重新录制', 422);
        }
        chunks.push(part.value);
      }
    } finally {
      if (reader === active) reader = null;
      active.releaseLock();
    }
    if (length !== asset.byte_size) throw new AppError('PRONUNCIATION_AUDIO_INVALID', '录音文件不完整，请重新录制', 422);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  };
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    cancelReader();
  }
}

export async function createSpeakingPronunciationAssessment(env: ApiEnv, userId: string, key: string,
  request: CreateSpeakingPronunciationRequest, provider?: PronunciationProvider): Promise<SpeakingPronunciationAssessmentDto> {
  await requireRegisteredUser(env, userId);
  const settings = getEvolinkAudioSettings(env);
  const fingerprint = await pronunciationFingerprint(request, settings.model);
  const requestHash = await pronunciationRequestFingerprint(request);
  await expireAssessments(env, userId);
  const previous = await findSpeakingIdempotency(env, userId, OPERATION, key, requestHash);
  if (previous) return getSpeakingPronunciationAssessment(env, userId, previous.resource_id);
  const cached = await speakingFirst<{ id: string }>(env, `SELECT id FROM speaking_pronunciation_assessments
    WHERE user_id = ? AND fingerprint = ? AND status IN ('ready', 'processing') LIMIT 1`, userId, fingerprint);
  if (cached) {
    const resource = await runSpeakingMutation(env,
      { userId, operation: OPERATION, key, requestHash, resourceId: cached.id }, recordId => [
        ...speakingGuard(env, recordId, "EXISTS (SELECT 1 FROM users WHERE id = ? AND kind = 'registered' AND deleted_at IS NULL)", [userId]),
        ...speakingGuard(env, recordId, 'EXISTS (SELECT 1 FROM speaking_pronunciation_assessments WHERE id = ? AND user_id = ? AND fingerprint = ?)',
          [cached.id, userId, fingerprint]),
      ]);
    return getSpeakingPronunciationAssessment(env, userId, resource);
  }
  if (!provider && !settings.apiKey) {
    throw new AppError('PRONUNCIATION_NOT_CONFIGURED', 'AI 口语点评服务尚未配置，请稍后再试', 503);
  }
  if (!provider) await assertAiAvailable(env);
  const asset = await getSpeakingAsset(env, userId, request.assetId);
  assertPronunciationAsset({ status: asset.status, purpose: asset.purpose,
    byteSize: asset.byte_size, contentType: asset.content_type, duration: asset.duration });
  const material = request.materialId === null ? null : await getSpeakingMaterial(env, userId, request.materialId);
  if (material) assertPronunciationReference(material, request);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const deadline = new Date(Date.now() + PRONUNCIATION_PROCESSING_TTL_MS).toISOString();
  const day = utcDay(now);
  let resource: string;
  try {
    resource = await runSpeakingMutation(env, {
      userId, operation: OPERATION, key, requestHash, resourceId: id,
    }, recordId => [
      ...speakingGuard(env, recordId, "EXISTS (SELECT 1 FROM users WHERE id = ? AND kind = 'registered' AND deleted_at IS NULL)", [userId]),
      ...referenceGuard(env, recordId, userId, material),
      ...speakingGuard(env, recordId, `EXISTS (SELECT 1 FROM speaking_assets WHERE id = ? AND user_id = ?
        AND status = 'ready' AND purpose = 'recording' AND byte_size = ? AND duration = ?
        AND content_type = ? AND etag = ? AND storage_key = ? AND (attached_at IS NOT NULL OR expires_at > ?))`,
      [asset.id, userId, asset.byte_size, asset.duration, asset.content_type, asset.etag, asset.storage_key, now]),
      // D1 batch 串行化同一指纹的占有；本事务的幂等记录指向真实复用行。
      env.DB.prepare(`UPDATE speaking_pronunciation_assessments SET status = 'failed', error_json = ?, updated_at = ?
        WHERE user_id = ? AND fingerprint = ? AND status = 'processing' AND deadline_at <= ? AND ${OWNED}`)
        .bind(JSON.stringify(expiredPronunciationError()), now, userId, fingerprint, now, recordId),
      env.DB.prepare(`UPDATE speaking_idempotency SET resource_id = COALESCE(
        (SELECT id FROM speaking_pronunciation_assessments WHERE user_id = ? AND fingerprint = ?
          AND status IN ('ready', 'processing') LIMIT 1), ?)
        WHERE id = ?`).bind(userId, fingerprint, id, recordId),
      ...speakingGuard(env, recordId, `(SELECT resource_id FROM speaking_idempotency WHERE id = ?) <> ? OR
        (SELECT COUNT(*) FROM speaking_pronunciation_assessments WHERE user_id = ? AND created_at >= ? AND created_at < ?) < ?`,
      [recordId, id, userId, day.start, day.end, settings.dailyLimit]),
      env.DB.prepare(`INSERT INTO speaking_pronunciation_assessments
        (id,user_id,asset_id,material_id,cue_id,reference_text,subtitle_revision,locale,fingerprint,
          provider,status,result_json,error_json,created_at,updated_at,deadline_at)
        SELECT ?,?,?,?,?,?,?,?,?,'evolink','processing',NULL,NULL,?,?,?
        WHERE EXISTS (SELECT 1 FROM speaking_idempotency WHERE id = ? AND resource_id = ?)`)
        .bind(id, userId, asset.id, request.materialId, request.cueId, request.referenceText,
          request.subtitleRevision, request.locale, fingerprint, now, now, deadline, recordId, id),
      ...speakingGuard(env, recordId, `EXISTS (SELECT 1 FROM speaking_pronunciation_assessments
        WHERE id = (SELECT resource_id FROM speaking_idempotency WHERE id = ?) AND user_id = ?)`, [recordId, userId]),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.code === 'STATE_CONFLICT' &&
      await dailyAttempts(env, userId, now) >= settings.dailyLimit) throw quotaError();
    throw error;
  }
  if (resource !== id) return getSpeakingPronunciationAssessment(env, userId, resource);

  let result: SpeakingPronunciationResult | null = null;
  let failure: SpeakingPronunciationError | null = null;
  try {
    const audio = await readRecording(env, userId, asset);
    // 读取媒体期间另一个请求可能已经将本尝试过期并重试；失去占有后不能再产生上游费用。
    const active = await speakingFirst<Pick<AssessmentRow, 'status' | 'deadline_at'>>(env,
      'SELECT status, deadline_at FROM speaking_pronunciation_assessments WHERE id = ? AND user_id = ?', id, userId);
    if (active?.status !== 'processing' || !(Date.parse(active.deadline_at) > Date.now())) {
      return getSpeakingPronunciationAssessment(env, userId, id);
    }
    // The injected provider is a test double; only real upstream calls count against the cap.
    if (!provider) await consumeAiCall(env);
    const assessor = provider ?? new EvolinkPronunciationProvider({ apiKey: settings.apiKey!,
      baseUrl: settings.baseUrl, model: settings.model, timeoutMs: settings.timeoutMs });
    const output = await assessor.assess({ audio, contentType: asset.content_type,
      referenceText: request.referenceText, locale: request.locale });
    const parsed = SpeakingAiCoachingResultSchema.safeParse(output);
    if (!parsed.success) throw new AppError('PRONUNCIATION_INVALID_RESULT', 'AI 口语点评结果无效，请重新尝试', 502, true);
    result = parsed.data;
  } catch (error) { failure = pronunciationFailure(error); }
  try {
    const updated = new Date().toISOString();
    await env.DB.prepare(`UPDATE speaking_pronunciation_assessments SET status = ?, result_json = ?, error_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'processing' AND deadline_at > ?`)
      .bind(failure ? 'failed' : 'ready', result === null ? null : JSON.stringify(result),
        failure === null ? null : JSON.stringify(failure), updated, id, userId, updated).run();
  } catch { throw databaseUnavailable(); }
  return getSpeakingPronunciationAssessment(env, userId, id);
}
