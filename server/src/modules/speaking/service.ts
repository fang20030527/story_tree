import {
  SpeakingLibraryDtoSchema, SpeakingMaterialDtoSchema, SpeakingSessionDtoSchema, SpeakingStateDtoSchema,
  UuidSchema, type CreateSpeakingMaterialRequest, type SpeakingCue, type SpeakingMaterialDto,
  type SpeakingMaterialSummary,
  type SaveSpeakingSessionRequest, type UpdateSpeakingStateRequest,
} from '@context-reader/contracts';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { speakingAssets, speakingMaterials, speakingSessions, speakingStates } from '../../db/schema';
import { beginIdempotentOperation, finishIdempotentOperation } from '../idempotency/service';
import { getOwnedSpeakingAsset } from './assets';
import { parseSpeakingSubtitles, validateSpeakingCues } from './subtitles';

export interface SpeakingDataDependencies {
  db: AppDatabase;
  catalog: ReadonlyMap<string, SpeakingMaterialDto>;
}
type Db = AppDatabase | AppTransaction;

export async function getSpeakingMaterial(deps: SpeakingDataDependencies, userId: string, materialId: string, db: Db = deps.db) {
  const platform = deps.catalog.get(materialId);
  if (platform) {
    const state = await findState(db, userId, materialId);
    return SpeakingMaterialDtoSchema.parse({ ...platform, cues: state?.customCues ?? platform.cues,
      revision: state?.customCues != null ? state.subtitleRevision : platform.revision });
  }
  if (!UuidSchema.safeParse(materialId).success) throw notFound();
  const [material] = await db.select().from(speakingMaterials).where(and(
    eq(speakingMaterials.id, materialId), eq(speakingMaterials.userId, userId))).limit(1);
  if (!material) throw notFound();
  return materialDto(material);
}

export async function getSpeakingLibrary(deps: SpeakingDataDependencies, userId: string,
  options: { cursor?: string | undefined; limit?: number | undefined } = {}) {
  const limit = options.limit ?? 20;
  let cursor: { id: string; createdAt: Date } | undefined;
  if (options.cursor) {
    const [found] = await deps.db.select({ id: speakingMaterials.id, createdAt: speakingMaterials.createdAt })
      .from(speakingMaterials).where(and(eq(speakingMaterials.userId, userId), eq(speakingMaterials.id, options.cursor)));
    if (!found) throw notFound(); cursor = found;
  }
  // 列表只查询摘要，避免将每部电影的完整字幕加载到服务器和客户端内存。
  const files = await deps.db.select({ id: speakingMaterials.id, title: speakingMaterials.title,
    sourceKind: speakingMaterials.sourceKind, assetId: speakingMaterials.assetId, videoId: speakingMaterials.videoId,
    duration: speakingMaterials.duration, mediaType: speakingMaterials.mediaType, revision: speakingMaterials.revision,
    createdAt: speakingMaterials.createdAt, cueCount: sql<number>`jsonb_array_length(${speakingMaterials.cues})` })
    .from(speakingMaterials).where(and(eq(speakingMaterials.userId, userId), ...(cursor ? [or(
      lt(speakingMaterials.createdAt, cursor.createdAt), and(eq(speakingMaterials.createdAt, cursor.createdAt), lt(speakingMaterials.id, cursor.id)))!] : [])))
    .orderBy(desc(speakingMaterials.createdAt), desc(speakingMaterials.id)).limit(limit + 1);
  const selected = files.slice(0, limit);
  const visibleIds = [...deps.catalog.keys(), ...selected.map(item => item.id)];
  const [states, sessions] = await Promise.all([
    deps.db.select({ materialId: speakingStates.materialId, revision: speakingStates.revision,
      savedCueIds: speakingStates.savedCueIds, notes: speakingStates.notes, position: speakingStates.position,
      recording: speakingStates.recording, subtitleRevision: speakingStates.subtitleRevision,
      customCueCount: sql<number | null>`jsonb_array_length(${speakingStates.customCues})` })
      .from(speakingStates).where(and(eq(speakingStates.userId, userId), inArray(speakingStates.materialId, visibleIds))),
    deps.db.select().from(speakingSessions).where(eq(speakingSessions.userId, userId)).orderBy(desc(speakingSessions.startedAt)).limit(1000),
  ]);
  const materials: SpeakingMaterialSummary[] = [...deps.catalog.values()].map(item => {
    const state = states.find(value => value.materialId === item.id);
    const { cues, ...summary } = item;
    return { ...summary, cueCount: state?.customCueCount ?? cues.length,
      revision: state?.customCueCount != null ? state.subtitleRevision : item.revision };
  });
  for (const item of selected) materials.push({ ...item, createdAt: item.createdAt.toISOString(),
    subtitle: item.sourceKind === 'youtube' ? '我的 YouTube 跟读' : '我的跟读文件', category: '个人文件' });
  return SpeakingLibraryDtoSchema.parse({ materials,
    states: states.map(state => ({ materialId: state.materialId, revision: state.revision,
      savedCueIds: state.savedCueIds, notes: state.notes, position: state.position, recording: state.recording })),
    sessions: sessions.map(sessionDto), nextCursor: files.length > limit ? selected.at(-1)!.id : null,
  });
}

export async function createSpeakingMaterial(deps: SpeakingDataDependencies, userId: string, key: string,
  request: CreateSpeakingMaterialRequest) {
  return deps.db.transaction(async tx => {
    const prior = await beginIdempotentOperation(tx, userId, 'create_speaking_material', key, request);
    if (prior) return getSpeakingMaterial(deps, userId, prior, tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`speaking-materials:${userId}`}))`);
    const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(speakingMaterials).where(eq(speakingMaterials.userId, userId));
    if ((count?.value ?? 0) >= 997) throw new AppError('MEDIA_STORAGE_LIMIT_REACHED', '素材数量已达上限', 409);
    let duration: number;
    let mediaType: 'audio' | 'video';
    let assetId: string | null = null;
    let videoId: string | null = null;
    if (request.sourceKind === 'file') {
      await tx.select({ id: speakingAssets.id }).from(speakingAssets).where(and(
        eq(speakingAssets.id, request.assetId), eq(speakingAssets.userId, userId))).for('update');
      const asset = await getOwnedSpeakingAsset(tx, userId, request.assetId);
      if (asset.purpose !== 'material' || asset.status !== 'ready' || !asset.storageKey || !asset.mediaType || asset.attachedAt) {
        throw new AppError('STATE_CONFLICT', '此媒体未完成上传或已经用于其他素材', 409);
      }
      duration = asset.duration; mediaType = asset.mediaType; assetId = asset.id;
    } else {
      duration = request.duration; mediaType = 'video'; videoId = request.videoId;
    }
    const cues = validateSpeakingCues(request.cues, duration);
    const [created] = await tx.insert(speakingMaterials).values({ userId, sourceKind: request.sourceKind,
      title: request.title, assetId, videoId, duration, mediaType, cues }).returning();
    if (!created) throw internalError();
    if (assetId) await tx.update(speakingAssets).set({ attachedAt: new Date() }).where(eq(speakingAssets.id, assetId));
    await finishIdempotentOperation(tx, userId, 'create_speaking_material', key, created.id);
    return materialDto(created);
  });
}

export async function updateSpeakingSubtitles(deps: SpeakingDataDependencies, userId: string,
  materialId: string, key: string, request: { revision: number; cues: SpeakingCue[] },
  requestIdentity: unknown = { kind: 'edit', ...request }) {
  return deps.db.transaction(async tx => {
    const prior = await beginIdempotentOperation(tx, userId, 'update_speaking_subtitles', key, { materialId, requestIdentity });
    await lockMaterialScope(tx, userId, materialId);
    if (prior) return getSpeakingMaterial(deps, userId, materialId, tx);
    await getSpeakingMaterial(deps, userId, materialId, tx);
    let result: SpeakingMaterialDto;
    let resourceId: string;
    if (deps.catalog.has(materialId)) {
      const state = await lockedState(tx, userId, materialId);
      const platform = deps.catalog.get(materialId)!;
      const revision = state.customCues != null ? state.subtitleRevision : platform.revision;
      if (revision !== request.revision) throw conflict();
      const cues = validateSpeakingCues(request.cues, platform.duration);
      await tx.update(speakingStates).set({ customCues: cues, subtitleRevision: revision + 1,
        updatedAt: new Date() }).where(eq(speakingStates.id, state.id));
      resourceId = state.id;
      result = { ...platform, cues, revision: revision + 1 };
    } else {
      const [current] = await tx.select().from(speakingMaterials).where(and(
        eq(speakingMaterials.id, materialId), eq(speakingMaterials.userId, userId))).for('update');
      if (!current) throw notFound();
      if (current.revision !== request.revision) throw conflict();
      const cues = validateSpeakingCues(request.cues, current.duration);
      const [updated] = await tx.update(speakingMaterials).set({ cues, revision: current.revision + 1,
        updatedAt: new Date() }).where(eq(speakingMaterials.id, materialId)).returning();
      if (!updated) throw internalError();
      resourceId = current.id; result = materialDto(updated);
    }
    await pruneState(tx, userId, materialId, result.cues);
    await finishIdempotentOperation(tx, userId, 'update_speaking_subtitles', key, resourceId);
    return result;
  });
}

export async function importSpeakingSubtitles(deps: SpeakingDataDependencies, userId: string,
  materialId: string, key: string, request: { revision: number; format: 'srt' | 'vtt'; text: string }) {
  // 先验证权限；不向外部获取字幕或发送源文本。
  await getSpeakingMaterial(deps, userId, materialId);
  return updateSpeakingSubtitles(deps, userId, materialId, key, {
    revision: request.revision, cues: parseSpeakingSubtitles(request.text, request.format),
  }, { kind: 'import', ...request });
}

export async function getSpeakingState(deps: SpeakingDataDependencies, userId: string, materialId: string) {
  await getSpeakingMaterial(deps, userId, materialId);
  const state = await findState(deps.db, userId, materialId);
  return state ? stateDto(state) : SpeakingStateDtoSchema.parse({ materialId, revision: 0, savedCueIds: [], notes: {}, position: 0, recording: null });
}

export async function updateSpeakingState(deps: SpeakingDataDependencies, userId: string,
  materialId: string, key: string, request: UpdateSpeakingStateRequest) {
  return deps.db.transaction(async tx => {
    const prior = await beginIdempotentOperation(tx, userId, 'update_speaking_state', key, { materialId, ...request });
    await lockMaterialScope(tx, userId, materialId);
    const material = await getSpeakingMaterial(deps, userId, materialId, tx);
    const state = await lockedState(tx, userId, materialId);
    if (prior) return stateDto(state);
    if (state.revision !== request.revision) throw conflict();
    const cueIds = new Set(material.cues.map(cue => cue.id));
    const referenced = [...(request.savedCueIds ?? []), ...Object.keys(request.notes ?? {}),
      ...(request.recording ? [request.recording.cueId] : [])];
    if (referenced.some(id => !cueIds.has(id))) throw new AppError('VALIDATION_ERROR', '句子不存在，请重新读取字幕后保存', 400);
    if (Buffer.byteLength(JSON.stringify({ savedCueIds: request.savedCueIds ?? state.savedCueIds,
      notes: request.notes ?? state.notes }), 'utf8') > 256 * 1024) {
      throw new AppError('VALIDATION_ERROR', '本素材的笔记和收藏内容过多，请减少后保存', 400);
    }
    if (request.position !== undefined && request.position > material.duration + 0.1) {
      throw new AppError('VALIDATION_ERROR', '播放位置超出了媒体时长', 400);
    }
    if (request.recording) {
      await tx.select({ id: speakingAssets.id }).from(speakingAssets).where(and(
        eq(speakingAssets.id, request.recording.assetId), eq(speakingAssets.userId, userId))).for('update');
      const asset = await getOwnedSpeakingAsset(tx, userId, request.recording.assetId);
      if (asset.status !== 'ready' || asset.purpose !== 'recording' || asset.mediaType !== 'audio' ||
        Math.abs(request.recording.durationMs - asset.duration * 1000) > 1500) {
        throw new AppError('VALIDATION_ERROR', '录音未完成上传或时长不匹配', 400);
      }
      if (asset.attachedAt && state.recording?.assetId !== asset.id) {
        throw new AppError('STATE_CONFLICT', '此录音已用于另一份练习，请重新上传', 409);
      }
      await tx.update(speakingAssets).set({ attachedAt: new Date() }).where(eq(speakingAssets.id, asset.id));
    }
    const patch = { ...request };
    const [updated] = await tx.update(speakingStates).set({ ...patch,
      ...(request.savedCueIds ? { savedCueIds: [...new Set(request.savedCueIds)] } : {}),
      revision: state.revision + 1, updatedAt: new Date() }).where(eq(speakingStates.id, state.id)).returning();
    if (!updated) throw internalError();
    if (request.recording !== undefined && state.recording?.assetId && state.recording.assetId !== updated.recording?.assetId) {
      await releaseRecording(tx, userId, state.recording.assetId);
    }
    await finishIdempotentOperation(tx, userId, 'update_speaking_state', key, state.id);
    return stateDto(updated);
  });
}

export async function saveSpeakingSession(deps: SpeakingDataDependencies, userId: string,
  clientId: string, key: string, request: SaveSpeakingSessionRequest) {
  return deps.db.transaction(async tx => {
    const prior = await beginIdempotentOperation(tx, userId, 'save_speaking_session', key, { clientId, ...request });
    await lockMaterialScope(tx, userId, request.materialId);
    const material = await getSpeakingMaterial(deps, userId, request.materialId, tx);
    if (request.cueCount > material.cues.length || request.position > material.duration + 0.1 ||
      new Date(request.date).getTime() > Date.now() + 300_000) {
      throw new AppError('VALIDATION_ERROR', '练习记录超出了素材范围', 400);
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`speaking-session:${userId}:${clientId}`}))`);
    const [existing] = await tx.select().from(speakingSessions).where(and(
      eq(speakingSessions.userId, userId), eq(speakingSessions.clientId, clientId))).for('update');
    if (prior && existing) return sessionDto(existing);
    if (existing && (existing.materialId !== request.materialId || existing.startedAt.getTime() !== new Date(request.date).getTime())) throw conflict();
    let session: typeof speakingSessions.$inferSelect;
    if (existing) {
      const [updated] = await tx.update(speakingSessions).set({
        elapsedMs: Math.max(existing.elapsedMs, request.elapsedMs), cueCount: Math.max(existing.cueCount, request.cueCount),
        updatedAt: new Date(),
      }).where(eq(speakingSessions.id, existing.id)).returning();
      if (!updated) throw internalError(); session = updated;
    } else {
      const [created] = await tx.insert(speakingSessions).values({ userId, clientId, materialId: request.materialId,
        title: material.title, startedAt: new Date(request.date), elapsedMs: request.elapsedMs, cueCount: request.cueCount }).returning();
      if (!created) throw internalError(); session = created;
    }
    if (!existing || request.elapsedMs >= existing.elapsedMs) {
      const state = await lockedState(tx, userId, request.materialId);
      if (!state.positionSessionDate || new Date(request.date).getTime() >= state.positionSessionDate.getTime()) {
        await tx.update(speakingStates).set({ position: request.position, revision: state.revision + 1,
          positionSessionDate: new Date(request.date), updatedAt: new Date() }).where(eq(speakingStates.id, state.id));
      }
    }
    await finishIdempotentOperation(tx, userId, 'save_speaking_session', key, session.id);
    return sessionDto(session);
  });
}

async function findState(db: Db, userId: string, materialId: string) {
  const [state] = await db.select().from(speakingStates).where(and(eq(speakingStates.userId, userId),
    eq(speakingStates.materialId, materialId))).limit(1);
  return state;
}
async function lockedState(tx: AppTransaction, userId: string, materialId: string) {
  await lockMaterialScope(tx, userId, materialId);
  const existing = await findState(tx, userId, materialId);
  if (existing) return existing;
  const [state] = await tx.insert(speakingStates).values({ userId, materialId }).returning();
  if (!state) throw internalError(); return state;
}
async function pruneState(tx: AppTransaction, userId: string, materialId: string, cues: SpeakingCue[]) {
  const state = await lockedState(tx, userId, materialId);
  const ids = new Set(cues.map(cue => cue.id));
  const savedCueIds = state.savedCueIds.filter(id => ids.has(id));
  const notes = Object.fromEntries(Object.entries(state.notes).filter(([id]) => ids.has(id)));
  const recording = state.recording && ids.has(state.recording.cueId) ? state.recording : null;
  await tx.update(speakingStates).set({ savedCueIds, notes, recording,
    revision: state.revision + 1, updatedAt: new Date() }).where(eq(speakingStates.id, state.id));
  if (state.recording && !recording) await releaseRecording(tx, userId, state.recording.assetId);
}
async function lockMaterialScope(tx: AppTransaction, userId: string, materialId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`speaking-state:${userId}:${materialId}`}))`);
}
async function releaseRecording(tx: AppTransaction, userId: string, assetId: string) {
  await tx.update(speakingAssets).set({ attachedAt: null, expiresAt: new Date() }).where(and(
    eq(speakingAssets.id, assetId), eq(speakingAssets.userId, userId), eq(speakingAssets.purpose, 'recording')));
}
function materialDto(value: typeof speakingMaterials.$inferSelect) {
  return SpeakingMaterialDtoSchema.parse({ id: value.id, title: value.title,
    subtitle: value.sourceKind === 'youtube' ? '我的 YouTube 跟读' : '我的跟读文件', category: '个人文件',
    sourceKind: value.sourceKind, assetId: value.assetId, videoId: value.videoId, mediaType: value.mediaType,
    duration: value.duration, cues: value.cues, revision: value.revision, createdAt: value.createdAt.toISOString() });
}
function stateDto(value: typeof speakingStates.$inferSelect) {
  return SpeakingStateDtoSchema.parse({ materialId: value.materialId, revision: value.revision,
    savedCueIds: value.savedCueIds, notes: value.notes, position: value.position, recording: value.recording });
}
function sessionDto(value: typeof speakingSessions.$inferSelect) {
  return SpeakingSessionDtoSchema.parse({ id: value.clientId, materialId: value.materialId,
    title: value.title, date: value.startedAt.toISOString(), elapsedMs: value.elapsedMs, cueCount: value.cueCount });
}
function conflict() { return new AppError('STATE_CONFLICT', '内容已更新，请重新读取后保存', 409, true); }
function notFound() { return new AppError('NOT_FOUND', '口语素材不存在', 404); }
function internalError() { return new AppError('INTERNAL_ERROR', '口语数据暂时无法保存', 500, true); }
