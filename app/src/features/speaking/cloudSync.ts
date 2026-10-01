import type {
  CreateSpeakingAssetRequest, SaveSpeakingSessionRequest, SpeakingAssetDto, SpeakingCatalogDto, SpeakingLibraryDto,
  SpeakingMaterialDto, SpeakingMaterialSummary, SpeakingStateDto, UpdateSpeakingStateRequest,
} from '@context-reader/contracts';
import { createSpeakingAsset, getSpeakingPlayback, getSpeakingState, saveSpeakingSession, updateSpeakingState, updateSpeakingSubtitles, uploadSpeakingAssetContent } from '@/api/speaking';
import { createIdempotencyKey } from '@/api/installation';
import { ApiError } from '@/api/client';
import { resolveSpeakingMedia, speakingMediaInfo } from './mediaStorage';
import { isRemoteSpeakingMaterial, type SpeakingCue, type SpeakingMaterial, type SpeakingStore } from './model';
import { speakingStorageKey, loadSpeakingStore, updateSpeakingStore } from './speakingStorage';

let cloudWrites: Promise<unknown> = Promise.resolve();
const operations = new Map<string, { key: string; body: unknown }>();
const recordingAssets = new Map<string, { key: string; body: CreateSpeakingAssetRequest; asset?: SpeakingAssetDto }>();
function serialize<T>(run: () => Promise<T>) {
  const operation = cloudWrites.then(run);
  cloudWrites = operation.catch(() => undefined);
  return operation;
}
async function assertScope(scope: string) {
  if (scope.endsWith(':guest') || await speakingStorageKey() !== scope) {
    throw new Error('登录状态已变化，请重新打开口语页面');
  }
}
// A lost response retries the original payload and key, including its original revision.
async function retainedWrite<T, B>(scope: string, name: string, identity: unknown, body: B, send: (body: B, key: string) => Promise<T>) {
  await assertScope(scope);
  const operationId = `${scope}:${name}:${JSON.stringify(identity)}`;
  let pending = operations.get(operationId);
  if (!pending) {
    pending = { key: await createIdempotencyKey(), body };
    operations.set(operationId, pending);
  }
  try {
    const result = await send(pending.body as B, pending.key);
    operations.delete(operationId);
    return result;
  } catch (error) {
    // A confirmed conflict rejected the write; a refreshed retry needs a new revision.
    if (error instanceof ApiError && error.code === 'STATE_CONFLICT') operations.delete(operationId);
    throw error;
  }
}
export function cloudSpeakingMaterial(material: SpeakingMaterialDto, synchronized = true): SpeakingMaterial {
  return {
    id: material.id, title: material.title, subtitle: material.subtitle, category: material.category,
    origin: material.sourceKind === 'platform' ? 'platform' : 'file', mediaType: material.mediaType,
    duration: material.duration, cues: material.cues, createdAt: material.createdAt,
    ...(synchronized ? { storage: 'cloud' as const } : {}), revision: material.revision, cueCount: material.cues.length, summary: false,
    ...(material.assetId ? { assetId: material.assetId } : {}),
    ...(material.videoId ? { videoId: material.videoId } : {}),
  };
}
function applyState(store: SpeakingStore, state: SpeakingStateDto) {
  if ((store.cloudStateRevisions[state.materialId] ?? 0) > state.revision) return;
  const pendingRecording = store.recordings[state.materialId]?.cloudPending ? store.recordings[state.materialId] : undefined;
  store.saved[state.materialId] = state.savedCueIds;
  store.notes[state.materialId] = state.notes;
  store.positions[state.materialId] = state.position;
  store.cloudStateRevisions[state.materialId] = state.revision;
  if (state.recording) store.recordings[state.materialId] = {
    mediaId: state.recording.assetId, assetId: state.recording.assetId,
    durationMs: state.recording.durationMs, cueId: state.recording.cueId,
  };
  else if (store.recordings[state.materialId]?.assetId) delete store.recordings[state.materialId];
  if (pendingRecording && (!pendingRecording.assetId || pendingRecording.assetId !== state.recording?.assetId)) store.recordings[state.materialId] = pendingRecording;
}
export function cacheSpeakingMaterial(store: SpeakingStore, dto: SpeakingMaterialDto, synchronized = true) {
  if ((store.cloudMaterials.find(item => item.id === dto.id)?.revision ?? 0) > dto.revision) return;
  const material = cloudSpeakingMaterial(dto, synchronized);
  // Keep one remote film's fetched captions. Authored local corrections are
  // separate from this disposable cache and must survive opening another film.
  if (isRemoteSpeakingMaterial(material)) {
    for (const previous of store.cloudMaterials) {
      if (previous.id !== material.id && isRemoteSpeakingMaterial(previous)) {
        delete store.cues[previous.id]; previous.cues = []; previous.summary = true;
        const file = store.files.find(item => item.id === previous.id);
        if (file) { file.cues = []; file.summary = true; }
      }
    }
  }
  const metadata = { ...material, cues: [] };
  store.cloudMaterials = [metadata, ...store.cloudMaterials.filter(item => item.id !== material.id)];
  if (material.origin === 'file') store.files = [metadata, ...store.files.filter(item => item.id !== material.id)];
  store.cues[material.id] = material.cues;
}
function cacheSpeakingSummary(store: SpeakingStore, dto: SpeakingMaterialSummary, synchronized = true) {
  const previous = store.cloudMaterials.find(item => item.id === dto.id);
  if ((previous?.revision ?? 0) > dto.revision) return;
  const reusable = previous?.revision === dto.revision;
  const cues = reusable ? store.cues[dto.id] ?? previous.cues : !previous ? store.cues[dto.id] ?? [] : [];
  const material = { ...cloudSpeakingMaterial({ ...dto, cues }, synchronized), cues: [], cueCount: dto.cueCount, summary: !reusable || previous?.summary === true || !cues.length };
  const metadataIndex = store.cloudMaterials.findIndex(item => item.id === material.id);
  if (metadataIndex < 0) store.cloudMaterials.push(material); else store.cloudMaterials[metadataIndex] = material;
  if (material.origin === 'file') {
    const fileIndex = store.files.findIndex(item => item.id === material.id);
    if (fileIndex < 0) store.files.push(material); else store.files[fileIndex] = material;
  }
  if (previous && !reusable) delete store.cues[dto.id];
}
function mergeIncomingState(store: SpeakingStore, state: SpeakingStateDto) {
  if ((store.cloudStateRevisions[state.materialId] ?? 0) > state.revision) return;
  const legacy = state.revision === 0;
  const saved = legacy ? store.saved[state.materialId] : undefined;
  const notes = legacy ? store.notes[state.materialId] : undefined;
  const position = legacy || store.history.some(item => item.materialId === state.materialId && item.cloudPending)
    ? store.positions[state.materialId] : undefined;
  applyState(store, state);
  if (saved) store.saved[state.materialId] = [...new Set([...state.savedCueIds, ...saved])];
  if (notes) store.notes[state.materialId] = { ...state.notes, ...notes };
  if (position !== undefined) store.positions[state.materialId] = position;
}
export function cacheSpeakingDetails(store: SpeakingStore, dto: SpeakingMaterialDto, state: SpeakingStateDto) {
  const previous = store.cloudMaterials.find(item => item.id === dto.id);
  const legacyCues = !previous || previous.revision === dto.revision ? store.cues[dto.id] : undefined;
  cacheSpeakingMaterial(store, dto);
  if (legacyCues?.length) store.cues[dto.id] = legacyCues;
  mergeIncomingState(store, state);
}
export function cacheSpeakingPublicDetails(store: SpeakingStore, dto: SpeakingMaterialDto) {
  if (dto.sourceKind !== 'platform') throw new Error('共享素材信息无效，请重试');
  cacheSpeakingMaterial(store, dto, false);
}
export function mergeSpeakingCatalog(store: SpeakingStore, catalog: SpeakingCatalogDto, synchronized: boolean) {
  for (const dto of catalog.materials) if (dto.sourceKind === 'platform') cacheSpeakingSummary(store, dto, synchronized);
  return store;
}
/** Keep pre-existing local files/history and the first local annotations for built-in material. */
export function mergeSpeakingCloudLibrary(store: SpeakingStore, library: SpeakingLibraryDto) {
  for (const dto of library.materials) {
    cacheSpeakingSummary(store, dto);
  }
  for (const state of library.states) {
    mergeIncomingState(store, state);
  }
  const sessions = new Map(store.history.map(item => [item.id, item]));
  for (const session of library.sessions) {
    const local = sessions.get(session.id);
    if (!local || session.elapsedMs >= local.elapsedMs) sessions.set(session.id, { ...session, cloudPending: false });
  }
  store.history = [...sessions.values()].sort((a, b) => b.date.localeCompare(a.date));
  return store;
}
async function syncLegacyAnnotations(material: SpeakingMaterial, scope: string, current: SpeakingStore) {
  if ((current.cloudStateRevisions[material.id] ?? 0) !== 0 || ((current.saved[material.id]?.length ?? 0) === 0 && Object.keys(current.notes[material.id] ?? {}).length === 0)) return;
  const patch = { savedCueIds: current.saved[material.id] ?? [], notes: current.notes[material.id] ?? {} };
  await retainedWrite(scope, `legacy-state:${material.id}`, patch, { revision: 0, ...patch }, async (request, key) => {
    const state = await updateSpeakingState(material.id, request, key);
    return updateSpeakingStore(store => applyState(store, state), scope);
  });
}
export function saveSpeakingMaterialSubtitles(material: SpeakingMaterial, scope: string, cues: SpeakingCue[]) {
  if (material.storage !== 'cloud') return updateSpeakingStore(store => {
    if (isRemoteSpeakingMaterial(material)) { store.localSubtitleOverrides[material.id] = cues; delete store.cues[material.id]; }
    else store.cues[material.id] = cues;
  }, scope);
  return serialize(async () => {
    const current = await loadSpeakingStore(scope);
    await syncLegacyAnnotations(material, scope, current);
    const revision = current.cloudMaterials.find(item => item.id === material.id)?.revision ?? material.revision ?? 1;
    return retainedWrite(scope, `subtitles:${material.id}`, cues, { revision, cues }, async (body, key) => {
      const dto = await updateSpeakingSubtitles(material.id, body, key);
      const state = await getSpeakingState(material.id);
      return updateSpeakingStore(store => { cacheSpeakingMaterial(store, dto); applyState(store, state); }, scope);
    });
  });
}
type StatePatch = Omit<UpdateSpeakingStateRequest, 'revision'>;
export function saveSpeakingMaterialState(material: SpeakingMaterial, scope: string, input: StatePatch | ((store: SpeakingStore) => StatePatch)) {
  if (material.storage !== 'cloud') return updateSpeakingStore(store => {
    const patch = typeof input === 'function' ? input(store) : input;
    if (patch.savedCueIds) store.saved[material.id] = patch.savedCueIds;
    if (patch.notes) store.notes[material.id] = patch.notes;
    if (patch.position !== undefined) store.positions[material.id] = patch.position;
  }, scope);
  return serialize(async () => {
    const current = await loadSpeakingStore(scope);
    const patch = typeof input === 'function' ? input(current) : input;
    // The first cloud edit includes legacy notes/favorites so they are not silently discarded.
    const body: UpdateSpeakingStateRequest = {
      revision: current.cloudStateRevisions[material.id] ?? 0,
      savedCueIds: current.saved[material.id] ?? [], notes: current.notes[material.id] ?? {}, ...patch,
    };
    return retainedWrite(scope, `state:${material.id}`, patch, body, async (request, key) => {
      await updateSpeakingState(material.id, request, key);
      const state = await getSpeakingState(material.id);
      return updateSpeakingStore(store => applyState(store, state), scope);
    });
  });
}
export const syncSpeakingSession = (material: SpeakingMaterial, scope: string, id: string, body: SaveSpeakingSessionRequest) =>
  serialize(async () => {
    if (body.materialId !== material.id) throw new Error('练习素材不一致，请重新打开页面');
    const current = await loadSpeakingStore(scope);
    await syncLegacyAnnotations(material, scope, current);
    return retainedWrite(scope, `session:${id}`, body, body, async (request, key) => {
      const session = await saveSpeakingSession(id, request, key);
      const state = await getSpeakingState(material.id);
      return updateSpeakingStore(store => {
        applyState(store, state);
        store.history = [{ ...session, cloudPending: false }, ...store.history.filter(item => item.id !== session.id)].sort((a, b) => b.date.localeCompare(a.date));
      }, scope);
    });
  });

export async function saveSpeakingCloudRecording(material: SpeakingMaterial, scope: string, recording: SpeakingStore['recordings'][string]) {
  await assertScope(scope);
  if (!Number.isFinite(recording.durationMs) || recording.durationMs <= 0 || recording.durationMs > 600_000) throw new Error('录音时长需在 10 分钟以内，请重新录制');
  const checkpointId = `${scope}:${recording.mediaId}`;
  let checkpoint = recordingAssets.get(checkpointId);
  const media = await resolveSpeakingMedia(recording.mediaId);
  try {
    const selected = { uri: media.uri, name: media.uri.endsWith('.m4a') ? 'recording.m4a' : 'recording.webm', lastModified: Date.now() };
    if (!checkpoint) {
      const info = await speakingMediaInfo(selected);
      checkpoint = { key: await createIdempotencyKey(), body: { ...info, purpose: 'recording' } };
      recordingAssets.set(checkpointId, checkpoint);
    }
    if (!checkpoint.asset || (checkpoint.asset.status !== 'ready' && checkpoint.asset.directUpload && Date.parse(checkpoint.asset.directUpload.expiresAt) <= Date.now() + 5_000)) {
      checkpoint.asset = await createSpeakingAsset(checkpoint.body, checkpoint.key);
    }
    if (checkpoint.asset.status !== 'ready') {
      checkpoint.asset = await uploadSpeakingAssetContent(checkpoint.asset, selected, { durationHintSeconds: recording.durationMs / 1000 });
    }
    const asset = checkpoint.asset;
    await updateSpeakingStore(store => { store.recordings[material.id] = { ...recording, assetId: asset.id, cloudPending: true }; }, scope);
    const store = await saveSpeakingMaterialState(material, scope, {
      recording: { assetId: asset.id, cueId: recording.cueId, durationMs: Math.max(1, Math.min(600_000, Math.round(recording.durationMs))) },
    });
    recordingAssets.delete(checkpointId);
    return store;
  } finally { media.release(); }
}
export async function resolveSpeakingRecording(recording: SpeakingStore['recordings'][string]) {
  if (recording.assetId) {
    const playback = await getSpeakingPlayback(recording.assetId);
    return { uri: playback.url, release: () => undefined };
  }
  return resolveSpeakingMedia(recording.mediaId);
}
