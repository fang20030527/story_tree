import {
  SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES, SPEAKING_PRONUNCIATION_MAX_DURATION_MS,
  type CreateSpeakingPronunciationRequest, type SpeakingMaterialDto,
  type SpeakingPronunciationCapability, type SpeakingPronunciationError,
} from '@context-reader/contracts';
import { AppError } from '../../core/errors';

export const PRONUNCIATION_PROCESSING_TTL_MS = 45_000;
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aiff']);

export function pronunciationCapability(apiKey: string | undefined): SpeakingPronunciationCapability {
  return { available: Boolean(apiKey?.trim()), provider: 'evolink',
    maxDurationMs: SPEAKING_PRONUNCIATION_MAX_DURATION_MS, maxAudioBytes: SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES,
    locales: ['en-us', 'en-gb'] };
}
export async function pronunciationFingerprint(request: CreateSpeakingPronunciationRequest, model = 'gemini-2.5-flash'): Promise<string> {
  return hash({ request, provider: 'evolink', model, version: 1 });
}
export async function pronunciationRequestFingerprint(request: CreateSpeakingPronunciationRequest): Promise<string> {
  const material = { assetId: request.assetId, materialId: request.materialId, cueId: request.cueId,
    referenceText: request.referenceText, subtitleRevision: request.subtitleRevision, locale: request.locale };
  return hash(material);
}
async function hash(value: unknown): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function assertPronunciationAsset(asset: { status: string; purpose: string; byteSize: number; contentType: string; duration: number }): void {
  if (asset.status !== 'ready' || asset.purpose !== 'recording' || !AUDIO_TYPES.has(asset.contentType.toLowerCase()) ||
      !Number.isSafeInteger(asset.byteSize) || asset.byteSize <= 0 || asset.byteSize > SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES ||
      !Number.isFinite(asset.duration) || asset.duration <= 0 || asset.duration * 1000 > SPEAKING_PRONUNCIATION_MAX_DURATION_MS) {
    throw new AppError('PRONUNCIATION_AUDIO_INVALID', '请提交不超过 30 秒、2 MB 的有效录音', 400);
  }
}
export function assertPronunciationReference(material: SpeakingMaterialDto, request: CreateSpeakingPronunciationRequest): void {
  const cue = material.cues.find(item => item.id === request.cueId);
  if (material.revision !== request.subtitleRevision || !cue || cue.en.trim() !== request.referenceText.trim()) {
    throw new AppError('STATE_CONFLICT', '字幕已变化，请重新打开当前句并录音后点评', 409);
  }
}
export function pronunciationFailure(error: unknown): SpeakingPronunciationError {
  if (error instanceof AppError) return { code: error.code, message: error.message, retryable: error.retryable };
  return { code: 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', message: 'AI 口语点评暂时不可用，请稍后重试', retryable: true };
}
export function expiredPronunciationError(): SpeakingPronunciationError {
  return { code: 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', message: '本次点评未完成，可以重试；录音已保留', retryable: true };
}
