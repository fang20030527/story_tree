import {
  CompleteSpeakingAssetRequestSchema, CreateSpeakingAssetRequestSchema, CreateSpeakingMaterialRequestSchema,
  ImportSpeakingSubtitlesRequestSchema, SaveSpeakingSessionRequestSchema,
  SpeakingAssetDtoSchema, SpeakingCapabilitiesDtoSchema, SpeakingCatalogDtoSchema, SpeakingLibraryDtoSchema,
  SpeakingMaterialDtoSchema, SpeakingPlaybackDtoSchema, SpeakingSessionDtoSchema,
  SpeakingStateDtoSchema, UpdateSpeakingStateRequestSchema, UpdateSpeakingSubtitlesRequestSchema,
  type CompleteSpeakingAssetRequest, type CreateSpeakingAssetRequest, type CreateSpeakingMaterialRequest,
  type SaveSpeakingSessionRequest, type SpeakingAssetDto, type UpdateSpeakingStateRequest,
} from '@context-reader/contracts';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import type { z, ZodType } from 'zod';
import { ApiError, apiRequest, getApiBaseUrl, publicApiRequest } from './client';
import { getInstallationToken } from './installation';
import { readSpeakingMediaDuration } from '@/features/speaking/mediaStorage';

function write<T>(path: string, schema: ZodType<T>, body: unknown, key: string, method = 'POST') {
  return apiRequest(path, schema, { method, headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
}
const materialPath = (id: string) => `/v1/speaking/materials/${encodeURIComponent(id)}`;
const catalogPath = (id: string) => `/v1/speaking/catalog/${encodeURIComponent(id)}`;
export const getSpeakingCatalog = () => publicApiRequest('/v1/speaking/catalog', SpeakingCatalogDtoSchema);
export const getSpeakingCatalogMaterial = (id: string) => publicApiRequest(catalogPath(id), SpeakingMaterialDtoSchema);
export const getSpeakingCatalogPlayback = (id: string) => publicApiRequest(`${catalogPath(id)}/playback`, SpeakingPlaybackDtoSchema);
export const getSpeakingCapabilities = () => apiRequest('/v1/speaking/capabilities', SpeakingCapabilitiesDtoSchema);
export function getSpeakingLibrary(options: { cursor?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  return apiRequest(`/v1/speaking/library${query.size ? `?${query}` : ''}`, SpeakingLibraryDtoSchema);
}
export const getSpeakingMaterial = (id: string) => apiRequest(materialPath(id), SpeakingMaterialDtoSchema);
export const getSpeakingState = (id: string) => apiRequest(`${materialPath(id)}/state`, SpeakingStateDtoSchema);
export const getSpeakingPlayback = (id: string) => apiRequest(`/v1/speaking/assets/${encodeURIComponent(id)}/playback`, SpeakingPlaybackDtoSchema);
export const createSpeakingAsset = (body: CreateSpeakingAssetRequest, key: string) =>
  write('/v1/speaking/assets', SpeakingAssetDtoSchema, CreateSpeakingAssetRequestSchema.parse(body), key);
export async function completeSpeakingAsset(id: string, body: CompleteSpeakingAssetRequest, key: string, options: { signal?: AbortSignal } = {}) {
  const result = await apiRequest(`/v1/speaking/assets/${encodeURIComponent(id)}/complete`, SpeakingAssetDtoSchema, {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(CompleteSpeakingAssetRequestSchema.parse(body)), signal: options.signal,
  });
  if (result.id !== id || result.status !== 'ready' || !CompleteSpeakingAssetRequestSchema.safeParse({ duration: result.duration }).success) {
    throw new ApiError('INVALID_SERVER_RESPONSE', '服务未确认文件上传，请重试', true);
  }
  return result;
}
export const createSpeakingMaterial = (body: CreateSpeakingMaterialRequest, key: string) =>
  write('/v1/speaking/materials', SpeakingMaterialDtoSchema, CreateSpeakingMaterialRequestSchema.parse(body), key);
export const updateSpeakingSubtitles = (id: string, body: z.infer<typeof UpdateSpeakingSubtitlesRequestSchema>, key: string) =>
  write(`${materialPath(id)}/subtitles`, SpeakingMaterialDtoSchema, UpdateSpeakingSubtitlesRequestSchema.parse(body), key, 'PATCH');
export const importSpeakingSubtitles = (id: string, body: z.infer<typeof ImportSpeakingSubtitlesRequestSchema>, key: string) =>
  write(`${materialPath(id)}/subtitles/import`, SpeakingMaterialDtoSchema, ImportSpeakingSubtitlesRequestSchema.parse(body), key);
export const updateSpeakingState = (id: string, body: UpdateSpeakingStateRequest, key: string) =>
  write(`${materialPath(id)}/state`, SpeakingStateDtoSchema, UpdateSpeakingStateRequestSchema.parse(body), key, 'PATCH');
export const saveSpeakingSession = (id: string, body: SaveSpeakingSessionRequest, key: string) =>
  write(`/v1/speaking/sessions/${encodeURIComponent(id)}`, SpeakingSessionDtoSchema, SaveSpeakingSessionRequestSchema.parse(body), key, 'PUT');

export type SpeakingUploadOptions = { signal?: AbortSignal; onProgress?: (fraction: number) => void; durationHintSeconds?: number; completeKey?: string };
const directUploads = new Map<string, { duration: number; key: string; uploaded: boolean }>();
function assertUploadNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new ApiError('NETWORK_ERROR', '上传已取消，可以重试', true);
}
async function uploadSpeakingAssetDirect(asset: SpeakingAssetDto, selected: DocumentPickerAsset, options: SpeakingUploadOptions) {
  const destination = asset.directUpload!;
  const url = new URL(destination.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new ApiError('INVALID_SERVER_RESPONSE', '上传地址无效', false);
  assertUploadNotCancelled(options.signal);
  let pending = directUploads.get(asset.id);
  if (!pending) {
    let duration: number;
    try { duration = await readSpeakingMediaDuration({ ...selected, mimeType: asset.contentType }, options); }
    catch {
      assertUploadNotCancelled(options.signal);
      throw new ApiError('SPEAKING_ASSET_DURATION_INVALID', '无法读取有效时长，请选择可播放且不超过 24 小时的音视频', true);
    }
    if (!CompleteSpeakingAssetRequestSchema.safeParse({ duration }).success) throw new ApiError('SPEAKING_ASSET_DURATION_INVALID', '音视频时长无效，请重新选择', false);
    pending = { duration, key: options.completeKey ?? `speaking-complete-${asset.id}`, uploaded: false };
    directUploads.set(asset.id, pending);
  }
  if (!pending.uploaded) {
    if (!Number.isFinite(Date.parse(destination.expiresAt)) || Date.parse(destination.expiresAt) <= Date.now()) {
      throw new ApiError('SPEAKING_UPLOAD_EXPIRED', '上传地址已过期，请重试获取新地址', true);
    }
    assertUploadNotCancelled(options.signal);
    const headers = { 'Content-Type': asset.contentType, 'If-None-Match': '*' };
    let status: number;
    try {
      if (Platform.OS === 'web') {
        const blob = selected.file ?? await (await fetch(selected.uri, { signal: options.signal })).blob();
        if (blob.size !== asset.byteSize) throw new ApiError('SPEAKING_ASSET_SIZE_INVALID', '文件大小发生变化，请重新选择', false);
        const result = await fetch(destination.url, { method: 'PUT', headers, body: blob, signal: options.signal, credentials: 'omit' });
        status = result.status;
      } else {
        const file = new File(selected.uri);
        if (file.size !== asset.byteSize) throw new ApiError('SPEAKING_ASSET_SIZE_INVALID', '文件大小发生变化，请重新选择', false);
        const result = await file.upload(destination.url, {
          httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers, signal: options.signal,
          onProgress: progress => options.onProgress?.(Math.min(1, progress.bytesSent / asset.byteSize)),
        });
        status = result.status;
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      assertUploadNotCancelled(options.signal);
      throw new ApiError('NETWORK_ERROR', '音视频上传失败，请重试', true);
    }
    // A lost PUT response may retry against the same object. R2's conditional
    // write rejects overwriting with 412; the API still validates the existing object.
    if ((status < 200 || status >= 300) && status !== 412) throw new ApiError('SPEAKING_UPLOAD_FAILED', '音视频上传未完成，请重试', true);
    pending.uploaded = true;
    options.onProgress?.(1);
  }
  assertUploadNotCancelled(options.signal);
  const ready = await completeSpeakingAsset(asset.id, { duration: pending.duration }, pending.key, options);
  assertUploadNotCancelled(options.signal);
  directUploads.delete(asset.id);
  return ready;
}

/** Native File.upload streams the file; expo/fetch currently buffers Blob bodies in JS. */
export async function uploadSpeakingAssetContent(
  asset: SpeakingAssetDto,
  selected: DocumentPickerAsset,
  options: SpeakingUploadOptions = {},
) {
  if (asset.directUpload) return uploadSpeakingAssetDirect(asset, selected, options);
  const path = `/v1/speaking/assets/${encodeURIComponent(asset.id)}/content`;
  if (asset.uploadPath !== path) throw new ApiError('INVALID_SERVER_RESPONSE', '上传地址无效', false);
  const token = await getInstallationToken();
  const url = `${getApiBaseUrl()}${path}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': asset.contentType };
  let status: number;
  let json: unknown;
  try {
    if (Platform.OS === 'web') {
      const blob = selected.file ?? await (await fetch(selected.uri)).blob();
      if (blob.size !== asset.byteSize) throw new ApiError('SPEAKING_ASSET_SIZE_INVALID', '文件大小发生变化，请重新选择', false);
      const result = await fetch(url, { method: 'PUT', headers, body: blob, signal: options.signal });
      status = result.status;
      json = await result.json();
    } else {
      const file = new File(selected.uri);
      if (file.size !== asset.byteSize) throw new ApiError('SPEAKING_ASSET_SIZE_INVALID', '文件大小发生变化，请重新选择', false);
      const result = await file.upload(url, {
        httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT,
        headers: { ...headers, 'Content-Length': String(asset.byteSize) },
        signal: options.signal,
        onProgress: progress => options.onProgress?.(Math.min(1, progress.bytesSent / asset.byteSize)),
      });
      status = result.status;
      json = JSON.parse(result.body) as unknown;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK_ERROR', options.signal?.aborted ? '上传已取消，可以重试' : '音视频上传失败，请重试', true);
  }
  if (status < 200 || status >= 300) {
    const error = ApiError.fromUnknown(json);
    throw new ApiError(error.code, error.message.split(token).join('[REDACTED]'), error.retryable, error.requestId);
  }
  const parsed = SpeakingAssetDtoSchema.safeParse(json);
  if (!parsed.success || parsed.data.id !== asset.id || parsed.data.status !== 'ready') {
    throw new ApiError('INVALID_SERVER_RESPONSE', '服务未确认文件上传，请重试', true);
  }
  return parsed.data;
}
