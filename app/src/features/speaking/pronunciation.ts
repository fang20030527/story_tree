import {
  CreateSpeakingPronunciationRequestSchema, SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES,
  SPEAKING_PRONUNCIATION_MAX_DURATION_MS,
  type CreateSpeakingPronunciationRequest, type SpeakingPronunciationAssessmentDto,
  type SpeakingPronunciationCapability, type SpeakingPronunciationLocale,
} from '@context-reader/contracts';
import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import { createSpeakingAsset, createSpeakingPronunciationAssessment, getSpeakingPronunciationAssessment, uploadSpeakingAssetContent } from '@/api/speaking';
import { resolveSpeakingMedia, speakingMediaInfo } from './mediaStorage';
import type { SpeakingMaterial, SpeakingPronunciationAttempt, SpeakingRecording } from './model';
import { loadSpeakingStore, speakingStorageKey, updateSpeakingStore } from './speakingStorage';

export const pronunciationRecordingId = (recording: SpeakingRecording) => recording.assetId ?? recording.mediaId;
export function speakingPronunciationKey(materialId: string, recording: SpeakingRecording, locale: SpeakingPronunciationLocale) {
  return JSON.stringify([materialId, pronunciationRecordingId(recording), recording.cueId, recording.referenceText ?? null, recording.subtitleRevision ?? null, locale]);
}
type Context = {
  materialId: string; material?: SpeakingMaterial; scope: string; recording: SpeakingRecording;
  locale: SpeakingPronunciationLocale; signal?: AbortSignal;
};
async function assertScope(scope: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new ApiError('REQUEST_CANCELLED', '评分已取消，可稍后继续', true);
  if (scope.endsWith(':guest')) throw new ApiError('LOGIN_REQUIRED', '请登录后再使用发音评分', false);
  if (await speakingStorageKey() !== scope) throw new ApiError('SPEAKING_ACCOUNT_CHANGED', '登录状态已变化，请重新打开口语页面', false);
  if (signal?.aborted) throw new ApiError('REQUEST_CANCELLED', '评分已取消，可稍后继续', true);
}
async function saveAttempt(scope: string, cacheKey: string, attempt: SpeakingPronunciationAttempt, signal?: AbortSignal) {
  await assertScope(scope, signal);
  await updateSpeakingStore(store => { store.pronunciations[cacheKey] = attempt; }, scope);
}
function checkResponse(response: SpeakingPronunciationAssessmentDto, request: CreateSpeakingPronunciationRequest, expectedId?: string) {
  if ((expectedId && response.id !== expectedId) || Object.entries(request).some(([name, value]) => response[name as keyof CreateSpeakingPronunciationRequest] !== value)) {
    throw new ApiError('INVALID_SERVER_RESPONSE', '评分与当前录音不一致，请重试', true);
  }
  return response;
}

/** Restores a known assessment without submitting or charging for another attempt. */
export async function restoreSpeakingPronunciation(context: Context): Promise<SpeakingPronunciationAssessmentDto | null> {
  await assertScope(context.scope, context.signal);
  const key = speakingPronunciationKey(context.materialId, context.recording, context.locale);
  const attempt = (await loadSpeakingStore(context.scope)).pronunciations[key];
  if (!attempt?.assessment || !attempt.request) return null;
  await assertScope(context.scope, context.signal);
  if (attempt.assessment.status === 'ready') return checkResponse(attempt.assessment, attempt.request);
  const assessment = checkResponse(await getSpeakingPronunciationAssessment(attempt.assessment.id, { signal: context.signal }), attempt.request, attempt.assessment.id);
  await saveAttempt(context.scope, key, { ...attempt, assessment }, context.signal);
  return assessment;
}

async function assessmentAsset(context: Context, key: string, attempt: SpeakingPronunciationAttempt, maxAudioBytes: number) {
  const saved = (await loadSpeakingStore(context.scope)).recordings[context.materialId];
  const cachedAssetId = saved && pronunciationRecordingId(saved) === pronunciationRecordingId(context.recording) ? saved.assessmentAssetId : undefined;
  const existingId = context.recording.assetId ?? attempt.request?.assetId ?? cachedAssetId;
  if (existingId) return existingId;
  await assertScope(context.scope, context.signal);
  const media = await resolveSpeakingMedia(context.recording.mediaId);
  try {
    const m4a = media.uri.toLowerCase().endsWith('.m4a');
    const selected = { uri: media.uri, name: m4a ? 'recording.m4a' : 'recording.webm', mimeType: m4a ? 'audio/mp4' : 'audio/webm', lastModified: Date.now() };
    if (!attempt.upload) {
      const info = await speakingMediaInfo(selected);
      if (info.byteSize > maxAudioBytes) throw new ApiError('SPEAKING_PRONUNCIATION_AUDIO_TOO_LARGE', '评分录音不能超过 2 MB，请缩短后重新录制', false);
      attempt.upload = { key: await createIdempotencyKey(), body: { ...info, purpose: 'recording' } };
      await saveAttempt(context.scope, key, attempt, context.signal);
    }
    const upload = attempt.upload;
    await assertScope(context.scope, context.signal);
    if (!upload.asset || (upload.asset.status !== 'ready' && upload.asset.directUpload && Date.parse(upload.asset.directUpload.expiresAt) <= Date.now() + 5_000)) {
      upload.asset = await createSpeakingAsset(upload.body, upload.key);
      await saveAttempt(context.scope, key, attempt, context.signal);
    }
    if (upload.asset.status !== 'ready') {
      await assertScope(context.scope, context.signal);
      upload.asset = await uploadSpeakingAssetContent(upload.asset, selected, { signal: context.signal, durationHintSeconds: context.recording.durationMs / 1000 });
      await saveAttempt(context.scope, key, attempt, context.signal);
    }
    const assetId = upload.asset.id;
    await assertScope(context.scope, context.signal);
    await updateSpeakingStore(store => {
      const saved = store.recordings[context.materialId];
      if (saved && pronunciationRecordingId(saved) === pronunciationRecordingId(context.recording)) saved.assessmentAssetId = assetId;
    }, context.scope);
    return assetId;
  } finally { media.release(); }
}

const submissions = new Map<string, Promise<SpeakingPronunciationAssessmentDto>>();
/** Persist the payload/key before POST so a lost response can safely replay it. */
export function submitSpeakingPronunciation(context: Context & { capability: SpeakingPronunciationCapability }) {
  const cacheKey = speakingPronunciationKey(context.materialId, context.recording, context.locale);
  const operationKey = `${context.scope}:${cacheKey}`;
  const current = submissions.get(operationKey);
  if (current) return current;
  const operation = submit(context, cacheKey).finally(() => { submissions.delete(operationKey); });
  submissions.set(operationKey, operation);
  return operation;
}
async function submit(context: Context & { capability: SpeakingPronunciationCapability }, cacheKey: string) {
  await assertScope(context.scope, context.signal);
  if (!context.capability.available || !context.capability.locales.includes(context.locale)) throw new ApiError('SPEAKING_PRONUNCIATION_UNAVAILABLE', '发音评分暂未开放，请稍后再试', false);
  if (!context.recording.referenceText) throw new ApiError('SPEAKING_RECORDING_SNAPSHOT_REQUIRED', '这条录音没有保存目标字幕，请重新录制后评分', false);
  if (context.recording.cloudPending) throw new ApiError('SPEAKING_RECORDING_NOT_SYNCED', '请先完成录音云端保存，再进行评分', false);
  const maxDurationMs = Math.min(context.capability.maxDurationMs, SPEAKING_PRONUNCIATION_MAX_DURATION_MS);
  if (!Number.isFinite(context.recording.durationMs) || context.recording.durationMs <= 0 || context.recording.durationMs > maxDurationMs) {
    throw new ApiError('SPEAKING_PRONUNCIATION_DURATION_INVALID', `请将一句话录在 ${Math.floor(maxDurationMs / 1000)} 秒以内，再进行发音评分`, false);
  }
  const cloudMaterial = context.material?.storage === 'cloud';
  if (!CreateSpeakingPronunciationRequestSchema.safeParse({
    assetId: context.recording.assetId ?? '00000000-0000-4000-8000-000000000000',
    materialId: cloudMaterial ? context.materialId : null, cueId: context.recording.cueId,
    referenceText: context.recording.referenceText, subtitleRevision: cloudMaterial ? context.recording.subtitleRevision ?? null : null,
    locale: context.locale,
  }).success) throw new ApiError('SPEAKING_RECORDING_SNAPSHOT_INVALID', '录音的目标字幕无效或过长，请选择短句重新录制', false);
  let attempt = (await loadSpeakingStore(context.scope)).pronunciations[cacheKey];
  await assertScope(context.scope, context.signal);
  if (attempt?.assessment?.status === 'ready' && attempt.request) return checkResponse(attempt.assessment, attempt.request);
  if (attempt?.assessment?.status === 'processing') {
    const recovered = await restoreSpeakingPronunciation(context);
    if (recovered) return recovered;
  }
  if (attempt?.assessment?.status === 'failed' && !attempt.assessment.error?.retryable) return attempt.assessment;
  if (!attempt || attempt.assessment?.status === 'failed') {
    const previous = attempt;
    attempt = {
      recordingId: pronunciationRecordingId(context.recording), locale: context.locale, idempotencyKey: await createIdempotencyKey(),
      ...(previous?.upload ? { upload: previous.upload } : {}), ...(previous?.request ? { request: previous.request } : {}),
    };
    await saveAttempt(context.scope, cacheKey, attempt, context.signal);
  }
  let assessment: SpeakingPronunciationAssessmentDto;
  try {
    if (!attempt.request) {
      const assetId = await assessmentAsset(context, cacheKey, attempt, Math.min(context.capability.maxAudioBytes, SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES));
      attempt.request = CreateSpeakingPronunciationRequestSchema.parse({
        assetId, materialId: cloudMaterial ? context.materialId : null, cueId: context.recording.cueId,
        referenceText: context.recording.referenceText, subtitleRevision: cloudMaterial ? context.recording.subtitleRevision ?? null : null,
        locale: context.locale,
      });
      await saveAttempt(context.scope, cacheKey, attempt, context.signal);
    }
    await assertScope(context.scope, context.signal);
    assessment = checkResponse(await createSpeakingPronunciationAssessment(attempt.request, attempt.idempotencyKey, { signal: context.signal }), attempt.request);
  } catch (failure) {
    if (!context.recording.assetId && failure instanceof ApiError && ['UPLOAD_SESSION_EXPIRED', 'NOT_FOUND'].includes(failure.code)) {
      const expiredAssetId = attempt.request?.assetId ?? attempt.upload?.asset?.id;
      await assertScope(context.scope, context.signal);
      await updateSpeakingStore(store => {
        // The server definitively rejected this temporary asset. A later user
        // click starts a new upload/key; never change a replayed key's payload.
        delete store.pronunciations[cacheKey];
        const saved = store.recordings[context.materialId];
        if (saved?.assessmentAssetId === expiredAssetId) delete saved.assessmentAssetId;
      }, context.scope);
      throw new ApiError('SPEAKING_PRONUNCIATION_UPLOAD_EXPIRED', '评分录音已过期，请再次点击评分重新上传；本机录音已保留', true);
    }
    throw failure;
  }
  await saveAttempt(context.scope, cacheKey, { ...attempt, assessment }, context.signal);
  return assessment;
}
