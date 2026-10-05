import {
  SpeakingCuesSchema, SpeakingLibraryDtoSchema, SpeakingMaterialDtoSchema, SpeakingMaterialSummarySchema,
  SpeakingSessionDtoSchema, SpeakingStateDtoSchema, UuidSchema,
  type CreateSpeakingMaterialRequest, type SaveSpeakingSessionRequest, type SpeakingCue,
  type SpeakingMaterialDto, type SpeakingMaterialSummary, type UpdateSpeakingStateRequest,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { parseSpeakingSubtitles, validateSpeakingCues } from '../../../../server/src/modules/speaking/subtitles';
import type { ApiEnv, D1StatementBinding } from '../env';
import { getPlatformCatalog, getPlatformMaterial } from './catalog';

interface MaterialRow {
  id: string; user_id: string; source_kind: 'file' | 'youtube'; title: string;
  asset_id: string | null; video_id: string | null; duration: number; media_type: 'audio' | 'video';
  cues_json: string; revision: number; created_at: string;
}
export interface SpeakingAssetRow {
  id: string; user_id: string; status: 'awaiting_upload' | 'ready'; content_type: string;
  byte_size: number; purpose: 'material' | 'recording'; storage_key: string; duration: number;
  media_type: 'audio' | 'video' | null; etag: string | null; expires_at: string;
  attached_at: string | null; created_at: string;
}
interface StateRow {
  user_id: string; material_id: string; revision: number; subtitle_revision: number;
  custom_cues_json?: string | null; custom_cue_count?: number | null;
  saved_cue_ids_json: string; notes_json: string; position: number;
  position_session_date: string | null; recording_json: string | null;
}
interface SessionRow {
  user_id: string; client_id: string; material_id: string; title: string;
  started_at: string; elapsed_ms: number; cue_count: number;
}
export interface SpeakingIdempotencyRow { id: string; request_hash: string; resource_id: string }
export interface SpeakingMutation {
  userId: string; operation: string; key: string; requestHash: string; resourceId: string;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const TTL_MS = 30 * 86_400_000;
const owned = 'EXISTS (SELECT 1 FROM speaking_idempotency WHERE id = ?)';
const encoder = new TextEncoder();

function serializedCues(cues: SpeakingCue[]): string {
  const text = JSON.stringify(cues);
  // D1 每行上限 2 MB，平台个人字幕还与最多 256 KiB 笔记共用状态行。
  if (encoder.encode(text).byteLength > 1_500_000) {
    throw new AppError('IMPORT_TOO_LARGE', '字幕内容过多，请拆分成多个素材', 413);
  }
  return text;
}

export function requireSpeakingIdempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key');
  if (!key || !KEY_PATTERN.test(key)) throw invalid('幂等键格式无效');
  return key;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export async function hashSpeakingRequest(value: unknown): Promise<string> {
  const bytes = encoder.encode(JSON.stringify(canonical(value)) ?? 'undefined');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function speakingFirst<T>(env: ApiEnv, sql: string, ...values: unknown[]): Promise<T | null> {
  try { return await env.DB.prepare(sql).bind(...values).first<T>(); }
  catch { throw databaseUnavailable(); }
}
async function all<T>(env: ApiEnv, sql: string, ...values: unknown[]): Promise<T[]> {
  try { return (await env.DB.prepare(sql).bind(...values).all<T>()).results; }
  catch { throw databaseUnavailable(); }
}

export async function findSpeakingIdempotency(env: ApiEnv, userId: string, operation: string,
  key: string, requestHash: string): Promise<SpeakingIdempotencyRow | null> {
  const record = await speakingFirst<SpeakingIdempotencyRow>(env,
    'SELECT id, request_hash, resource_id FROM speaking_idempotency WHERE user_id = ? AND operation = ? AND idempotency_key = ?',
    userId, operation, key);
  if (record && record.request_hash !== requestHash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  return record;
}

/** 必须紧跟目标 CAS 写入，或传入只包含服务端静态 SQL 的断言。 */
export function speakingGuard(env: ApiEnv, recordId: string, condition = 'changes() = 1', values: unknown[] = []): D1StatementBinding[] {
  const id = crypto.randomUUID();
  return [
    env.DB.prepare(`INSERT INTO transaction_guards (id, valid)
      SELECT ?, CASE WHEN NOT ${owned} OR (${condition}) THEN 1 ELSE 0 END`).bind(id, recordId, ...values),
    env.DB.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(id),
  ];
}

/** D1 batch 是事务；所有写入都必须由本次 recordId 门控，竞争失败者只回放。 */
export async function runSpeakingMutation(env: ApiEnv, mutation: SpeakingMutation,
  writes: (recordId: string) => D1StatementBinding[]): Promise<string> {
  const previous = await findSpeakingIdempotency(env, mutation.userId, mutation.operation, mutation.key, mutation.requestHash);
  if (previous) return previous.resource_id;
  const recordId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO speaking_idempotency
        (id, user_id, operation, idempotency_key, request_hash, resource_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING`)
        .bind(recordId, mutation.userId, mutation.operation, mutation.key, mutation.requestHash, mutation.resourceId,
          now, new Date(Date.now() + TTL_MS).toISOString()),
      ...writes(recordId),
    ]);
  } catch (error) {
    const replay = await findSpeakingIdempotency(env, mutation.userId, mutation.operation, mutation.key, mutation.requestHash);
    if (replay) return replay.resource_id;
    const message = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}` : '';
    if (/CHECK constraint failed|transaction_guards|SQLITE_CONSTRAINT/iu.test(message)) throw conflict();
    throw databaseUnavailable();
  }
  const record = await findSpeakingIdempotency(env, mutation.userId, mutation.operation, mutation.key, mutation.requestHash);
  if (!record) throw databaseUnavailable();
  return record.resource_id;
}

export async function getSpeakingAsset(env: ApiEnv, userId: string, id: string): Promise<SpeakingAssetRow> {
  const row = await speakingFirst<SpeakingAssetRow>(env, 'SELECT * FROM speaking_assets WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('媒体文件不存在');
  if (!row.attached_at && row.expires_at <= new Date().toISOString()) {
    throw new AppError('UPLOAD_SESSION_EXPIRED', '媒体上传已过期，请重新选择文件', 410);
  }
  return row;
}

function stateDto(row: StateRow | null, id: string) {
  return SpeakingStateDtoSchema.parse(row ? {
    materialId: row.material_id, revision: row.revision, savedCueIds: JSON.parse(row.saved_cue_ids_json) as unknown,
    notes: JSON.parse(row.notes_json) as unknown, position: row.position,
    recording: row.recording_json ? JSON.parse(row.recording_json) as unknown : null,
  } : { materialId: id, revision: 0, savedCueIds: [], notes: {}, position: 0, recording: null });
}
function materialDto(row: MaterialRow) {
  return SpeakingMaterialDtoSchema.parse({ id: row.id, title: row.title,
    subtitle: row.source_kind === 'youtube' ? '我的 YouTube 跟读' : '我的跟读文件', category: '个人文件',
    sourceKind: row.source_kind, mediaType: row.media_type, assetId: row.asset_id, videoId: row.video_id,
    duration: row.duration, revision: row.revision, createdAt: row.created_at, cues: JSON.parse(row.cues_json) as unknown });
}
function sessionDto(row: SessionRow) {
  return SpeakingSessionDtoSchema.parse({ id: row.client_id, materialId: row.material_id, title: row.title,
    date: row.started_at, elapsedMs: row.elapsed_ms, cueCount: row.cue_count });
}
async function stateRow(env: ApiEnv, userId: string, materialId: string): Promise<StateRow | null> {
  return speakingFirst<StateRow>(env, 'SELECT * FROM speaking_states WHERE user_id = ? AND material_id = ?', userId, materialId);
}
function ensureState(env: ApiEnv, recordId: string, userId: string, material: SpeakingMaterialDto): D1StatementBinding {
  return env.DB.prepare(`INSERT OR IGNORE INTO speaking_states (user_id, material_id, subtitle_revision)
    SELECT ?, ?, ? WHERE ${owned}`).bind(userId, material.id, material.sourceKind === 'platform' ? material.revision : 1, recordId);
}
function materialCondition(material: SpeakingMaterialDto, userId: string): { sql: string; values: unknown[] } {
  return material.sourceKind === 'platform' ? {
    sql: 'COALESCE((SELECT CASE WHEN custom_cues_json IS NOT NULL THEN subtitle_revision ELSE ? END FROM speaking_states WHERE user_id = ? AND material_id = ?), ?) = ?',
    values: [material.revision, userId, material.id, material.revision, material.revision],
  } : {
    sql: 'EXISTS (SELECT 1 FROM speaking_materials WHERE user_id = ? AND id = ? AND revision = ?)',
    values: [userId, material.id, material.revision],
  };
}
function releaseRecording(env: ApiEnv, recordId: string, userId: string, assetId: string): D1StatementBinding {
  return env.DB.prepare(`UPDATE speaking_assets SET attached_at = NULL, expires_at = ?
    WHERE id = ? AND user_id = ? AND purpose = 'recording' AND ${owned}`)
    .bind(new Date().toISOString(), assetId, userId, recordId);
}

export async function getSpeakingMaterial(env: ApiEnv, userId: string, materialId: string): Promise<SpeakingMaterialDto> {
  const catalog = await getPlatformCatalog(env);
  if (catalog.materials.some(item => item.id === materialId)) {
    const [platform, state] = await Promise.all([getPlatformMaterial(env, materialId), stateRow(env, userId, materialId)]);
    // The released captions were validated when cached; only the account's own edit needs a parse.
    if (!state?.custom_cues_json) return platform;
    return SpeakingMaterialDtoSchema.parse({ ...platform,
      cues: SpeakingCuesSchema.parse(JSON.parse(state.custom_cues_json) as unknown),
      revision: state.subtitle_revision });
  }
  if (!UuidSchema.safeParse(materialId).success) throw notFound();
  const row = await speakingFirst<MaterialRow>(env, 'SELECT * FROM speaking_materials WHERE user_id = ? AND id = ?', userId, materialId);
  if (!row) throw notFound();
  return materialDto(row);
}

export async function getSpeakingLibrary(env: ApiEnv, userId: string, query: { cursor?: string | undefined; limit: number }) {
  const catalog = await getPlatformCatalog(env);
  let cursor: { id: string; created_at: string } | null = null;
  if (query.cursor) {
    cursor = await speakingFirst(env, 'SELECT id, created_at FROM speaking_materials WHERE user_id = ? AND id = ?', userId, query.cursor);
    if (!cursor) throw notFound();
  }
  const params: unknown[] = [userId];
  const predicate = cursor ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : '';
  if (cursor) params.push(cursor.created_at, cursor.created_at, cursor.id);
  const files = await all<Omit<MaterialRow, 'cues_json'> & { cue_count: number }>(env,
    `SELECT id, user_id, source_kind, title, asset_id, video_id, duration, media_type, revision, created_at,
      json_array_length(cues_json) AS cue_count FROM speaking_materials WHERE user_id = ? ${predicate}
      ORDER BY created_at DESC, id DESC LIMIT ?`, ...params, query.limit + 1);
  const selected = files.slice(0, query.limit);
  const visible = [...catalog.materials.map(item => item.id), ...selected.map(item => item.id)];
  const states: StateRow[] = [];
  // D1 单条语句最多 100 个绑定参数，目录和个人页合计可以超过这个数量。
  for (let offset = 0; offset < visible.length; offset += 90) {
    const ids = visible.slice(offset, offset + 90);
    states.push(...await all<StateRow>(env,
      `SELECT user_id, material_id, revision, subtitle_revision, saved_cue_ids_json, notes_json, position,
        position_session_date, recording_json, json_array_length(custom_cues_json) AS custom_cue_count
        FROM speaking_states WHERE user_id = ? AND material_id IN (${ids.map(() => '?').join(',')})`, userId, ...ids));
  }
  const sessions = await all<SessionRow>(env,
    'SELECT user_id, client_id, material_id, title, started_at, elapsed_ms, cue_count FROM speaking_sessions WHERE user_id = ? ORDER BY started_at DESC, client_id DESC LIMIT 1000', userId);
  const materials: SpeakingMaterialSummary[] = catalog.materials.map(item => {
    const state = states.find(row => row.material_id === item.id);
    return { ...item, cueCount: state?.custom_cue_count ?? item.cueCount,
      revision: state?.custom_cue_count != null ? state.subtitle_revision : item.revision };
  });
  for (const row of selected) materials.push(SpeakingMaterialSummarySchema.parse({ id: row.id, title: row.title,
    subtitle: row.source_kind === 'youtube' ? '我的 YouTube 跟读' : '我的跟读文件', category: '个人文件',
    sourceKind: row.source_kind, mediaType: row.media_type, assetId: row.asset_id, videoId: row.video_id,
    duration: row.duration, revision: row.revision, createdAt: row.created_at, cueCount: row.cue_count }));
  return SpeakingLibraryDtoSchema.parse({ materials, states: states.map(row => stateDto(row, row.material_id)),
    sessions: sessions.map(sessionDto), nextCursor: files.length > query.limit ? selected.at(-1)!.id : null });
}

export async function createSpeakingMaterial(env: ApiEnv, userId: string, key: string, request: CreateSpeakingMaterialRequest) {
  const hash = await hashSpeakingRequest(request);
  const prior = await findSpeakingIdempotency(env, userId, 'create_material', key, hash);
  if (prior) return getSpeakingMaterial(env, userId, prior.resource_id);
  const asset = request.sourceKind === 'file' ? await getSpeakingAsset(env, userId, request.assetId) : null;
  if (asset && (asset.status !== 'ready' || asset.purpose !== 'material' || !asset.media_type || asset.attached_at)) {
    // 预读与提交之间，同键请求可能已经完成绑定；先回放它的结果。
    const replay = await findSpeakingIdempotency(env, userId, 'create_material', key, hash);
    if (replay) return getSpeakingMaterial(env, userId, replay.resource_id);
    throw conflict();
  }
  const duration = asset?.duration ?? (request.sourceKind === 'youtube' ? request.duration : 0);
  const mediaType = asset?.media_type ?? 'video';
  const cues = validateSpeakingCues(request.cues, duration);
  const cuesJson = serializedCues(cues);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const resource = await runSpeakingMutation(env, { userId, operation: 'create_material', key, requestHash: hash, resourceId: id }, recordId => {
    const writes: D1StatementBinding[] = [
      ...speakingGuard(env, recordId, '(SELECT COUNT(*) FROM speaking_materials WHERE user_id = ?) < 997', [userId]),
    ];
    if (asset) {
      writes.push(env.DB.prepare(`UPDATE speaking_assets SET attached_at = ? WHERE id = ? AND user_id = ?
        AND status = 'ready' AND purpose = 'material' AND attached_at IS NULL
        AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND duration = ? AND media_type = ? AND ${owned}`).bind(now, asset.id, userId, duration, mediaType, recordId),
      ...speakingGuard(env, recordId));
    }
    writes.push(env.DB.prepare(`INSERT INTO speaking_materials
      (id, user_id, source_kind, title, asset_id, video_id, duration, media_type, cues_json, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${owned}`)
      .bind(id, userId, request.sourceKind, request.title, asset?.id ?? null,
        request.sourceKind === 'youtube' ? request.videoId : null, duration, mediaType, cuesJson, now, now, recordId),
    ...speakingGuard(env, recordId));
    return writes;
  });
  return getSpeakingMaterial(env, userId, resource);
}

export async function updateSpeakingSubtitles(env: ApiEnv, userId: string, materialId: string, key: string,
  request: { revision: number; cues: SpeakingCue[] }, identity: unknown = { kind: 'edit', ...request }) {
  const hash = await hashSpeakingRequest({ materialId, identity });
  const prior = await findSpeakingIdempotency(env, userId, 'update_subtitles', key, hash);
  if (prior) return getSpeakingMaterial(env, userId, materialId);
  const [material, state] = await Promise.all([getSpeakingMaterial(env, userId, materialId), stateRow(env, userId, materialId)]);
  if (material.revision !== request.revision) {
    if (await findSpeakingIdempotency(env, userId, 'update_subtitles', key, hash)) return getSpeakingMaterial(env, userId, materialId);
    throw conflict();
  }
  const cues = validateSpeakingCues(request.cues, material.duration);
  const cuesJson = serializedCues(cues);
  const current = stateDto(state, materialId);
  const ids = new Set(cues.map(cue => cue.id));
  const saved = current.savedCueIds.filter(id => ids.has(id));
  const notes = Object.fromEntries(Object.entries(current.notes).filter(([id]) => ids.has(id)));
  const recording = current.recording && ids.has(current.recording.cueId) ? current.recording : null;
  const now = new Date().toISOString();
  await runSpeakingMutation(env, { userId, operation: 'update_subtitles', key, requestHash: hash, resourceId: materialId }, recordId => {
    const condition = materialCondition(material, userId);
    const writes = [ensureState(env, recordId, userId, material), ...speakingGuard(env, recordId, condition.sql, condition.values)];
    if (material.sourceKind !== 'platform') {
      writes.push(env.DB.prepare(`UPDATE speaking_materials SET cues_json = ?, revision = revision + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND revision = ? AND ${owned}`)
        .bind(cuesJson, now, userId, materialId, request.revision, recordId), ...speakingGuard(env, recordId));
    }
    writes.push(env.DB.prepare(`UPDATE speaking_states SET saved_cue_ids_json = ?, notes_json = ?, recording_json = ?,
      revision = revision + 1, custom_cues_json = ?, subtitle_revision = ?, updated_at = ?
      WHERE user_id = ? AND material_id = ? AND revision = ? AND ${owned}`)
      .bind(JSON.stringify(saved), JSON.stringify(notes), recording ? JSON.stringify(recording) : null,
        material.sourceKind === 'platform' ? cuesJson : state?.custom_cues_json ?? null,
        material.sourceKind === 'platform' ? request.revision + 1 : state?.subtitle_revision ?? 1,
        now, userId, materialId, current.revision, recordId), ...speakingGuard(env, recordId));
    if (current.recording && !recording) writes.push(releaseRecording(env, recordId, userId, current.recording.assetId));
    return writes;
  });
  return getSpeakingMaterial(env, userId, materialId);
}

export async function importSpeakingSubtitles(env: ApiEnv, userId: string, materialId: string, key: string,
  request: { revision: number; format: 'srt' | 'vtt'; text: string }) {
  await getSpeakingMaterial(env, userId, materialId);
  return updateSpeakingSubtitles(env, userId, materialId, key,
    { revision: request.revision, cues: parseSpeakingSubtitles(request.text, request.format) }, { kind: 'import', ...request });
}

export async function getSpeakingState(env: ApiEnv, userId: string, materialId: string) {
  await getSpeakingMaterial(env, userId, materialId);
  return stateDto(await stateRow(env, userId, materialId), materialId);
}

export async function updateSpeakingState(env: ApiEnv, userId: string, materialId: string, key: string, request: UpdateSpeakingStateRequest) {
  const hash = await hashSpeakingRequest({ materialId, ...request });
  if (await findSpeakingIdempotency(env, userId, 'update_state', key, hash)) return getSpeakingState(env, userId, materialId);
  const [material, row] = await Promise.all([getSpeakingMaterial(env, userId, materialId), stateRow(env, userId, materialId)]);
  const state = stateDto(row, materialId);
  if (state.revision !== request.revision) {
    if (await findSpeakingIdempotency(env, userId, 'update_state', key, hash)) return getSpeakingState(env, userId, materialId);
    throw conflict();
  }
  const cueIds = new Set(material.cues.map(cue => cue.id));
  const referenced = [...(request.savedCueIds ?? []), ...Object.keys(request.notes ?? {}), ...(request.recording ? [request.recording.cueId] : [])];
  if (referenced.some(id => !cueIds.has(id))) throw invalid('句子不存在，请重新读取字幕后保存');
  const saved = request.savedCueIds ? [...new Set(request.savedCueIds)] : state.savedCueIds;
  const notes = request.notes ?? state.notes;
  if (encoder.encode(JSON.stringify({ savedCueIds: saved, notes })).byteLength > 256 * 1024) throw invalid('本素材的笔记和收藏内容过多，请减少后保存');
  const position = request.position ?? state.position;
  if (position > material.duration + 0.1) throw invalid('播放位置超出了媒体时长');
  const recording = request.recording === undefined ? state.recording : request.recording;
  const asset = request.recording ? await getSpeakingAsset(env, userId, request.recording.assetId) : null;
  if (asset && (asset.status !== 'ready' || asset.purpose !== 'recording' || asset.media_type !== 'audio' ||
    Math.abs(asset.duration * 1000 - request.recording!.durationMs) > 1500)) throw invalid('录音未完成上传或时长不匹配');
  if (asset?.attached_at && asset.id !== state.recording?.assetId) {
    if (await findSpeakingIdempotency(env, userId, 'update_state', key, hash)) return getSpeakingState(env, userId, materialId);
    throw conflict();
  }
  const now = new Date().toISOString();
  await runSpeakingMutation(env, { userId, operation: 'update_state', key, requestHash: hash, resourceId: materialId }, recordId => {
    const condition = materialCondition(material, userId);
    const writes = [ensureState(env, recordId, userId, material), ...speakingGuard(env, recordId, condition.sql, condition.values)];
    if (asset) {
      writes.push(env.DB.prepare(`UPDATE speaking_assets SET attached_at = ? WHERE id = ? AND user_id = ?
        AND status = 'ready' AND purpose = 'recording' AND media_type = 'audio' AND duration = ?
        AND (attached_at IS NULL OR id = ?)
        AND (attached_at IS NOT NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AND ${owned}`)
        .bind(now, asset.id, userId, asset.duration, state.recording?.assetId ?? '', recordId), ...speakingGuard(env, recordId));
    }
    writes.push(env.DB.prepare(`UPDATE speaking_states SET saved_cue_ids_json = ?, notes_json = ?, position = ?,
      recording_json = ?, revision = revision + 1, updated_at = ?
      WHERE user_id = ? AND material_id = ? AND revision = ? AND ${owned}`)
      .bind(JSON.stringify(saved), JSON.stringify(notes), position, recording ? JSON.stringify(recording) : null,
        now, userId, materialId, request.revision, recordId), ...speakingGuard(env, recordId));
    if (request.recording !== undefined && state.recording && state.recording.assetId !== recording?.assetId) {
      writes.push(releaseRecording(env, recordId, userId, state.recording.assetId));
    }
    return writes;
  });
  return getSpeakingState(env, userId, materialId);
}

export async function saveSpeakingSession(env: ApiEnv, userId: string, clientId: string, key: string, request: SaveSpeakingSessionRequest) {
  const startedAt = new Date(request.date).toISOString();
  const hash = await hashSpeakingRequest({ clientId, ...request, date: startedAt });
  const prior = await findSpeakingIdempotency(env, userId, 'save_session', key, hash);
  if (!prior) {
    const material = await getSpeakingMaterial(env, userId, request.materialId);
    if (request.cueCount > material.cues.length || request.position > material.duration + 0.1 ||
      new Date(request.date).getTime() > Date.now() + 300_000) throw invalid('练习记录超出了素材范围');
    await runSpeakingMutation(env, { userId, operation: 'save_session', key, requestHash: hash, resourceId: clientId }, recordId => {
      const condition = materialCondition(material, userId);
      const writes = [ensureState(env, recordId, userId, material), ...speakingGuard(env, recordId, condition.sql, condition.values),
        ...speakingGuard(env, recordId, `NOT EXISTS (SELECT 1 FROM speaking_sessions WHERE user_id = ? AND client_id = ?)
          OR EXISTS (SELECT 1 FROM speaking_sessions WHERE user_id = ? AND client_id = ? AND material_id = ? AND started_at = ?)`,
        [userId, clientId, userId, clientId, request.materialId, startedAt]),
        env.DB.prepare(`UPDATE speaking_states SET position = ?, position_session_date = ?, revision = revision + 1, updated_at = ?
          WHERE user_id = ? AND material_id = ? AND ${owned}
          AND (position_session_date IS NULL OR position_session_date <= ?)
          AND COALESCE((SELECT elapsed_ms FROM speaking_sessions WHERE user_id = ? AND client_id = ?), -1) <= ?`)
          .bind(request.position, startedAt, new Date().toISOString(), userId, request.materialId, recordId,
            startedAt, userId, clientId, request.elapsedMs),
        env.DB.prepare(`INSERT INTO speaking_sessions (user_id, client_id, material_id, title, started_at, elapsed_ms, cue_count)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${owned}
          ON CONFLICT(user_id, client_id) DO UPDATE SET elapsed_ms = MAX(elapsed_ms, excluded.elapsed_ms),
            cue_count = MAX(cue_count, excluded.cue_count), updated_at = ?`)
          .bind(userId, clientId, request.materialId, material.title, startedAt, request.elapsedMs, request.cueCount, recordId, new Date().toISOString()),
        ...speakingGuard(env, recordId),
      ];
      return writes;
    });
  }
  const session = await speakingFirst<SessionRow>(env,
    'SELECT * FROM speaking_sessions WHERE user_id = ? AND client_id = ?', userId, clientId);
  if (!session) throw notFound('练习记录不存在');
  return sessionDto(session);
}

function conflict() { return new AppError('STATE_CONFLICT', '内容已更新，请重新读取后保存', 409, true); }
function notFound(message = '口语素材不存在') { return new AppError('NOT_FOUND', message, 404); }
function invalid(message: string) { return new AppError('VALIDATION_ERROR', message, 400); }
function databaseUnavailable() { return new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true); }
