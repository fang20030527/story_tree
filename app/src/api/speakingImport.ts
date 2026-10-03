import { SPEAKING_MAX_REMOTE_MEDIA_BYTES, SpeakingMediaTypeSchema, SpeakingRemoteMediaRequestSchema } from '@context-reader/contracts';
import { fetch as nativeFetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { downloadedSpeakingMedia } from '@/features/speaking/importMedia';
import { ApiError, getApiBaseUrl } from './client';
import { getInstallationToken } from './installation';

export async function downloadSpeakingRemoteMedia(url: string, options: { signal?: AbortSignal } = {}) {
  const request = SpeakingRemoteMediaRequestSchema.safeParse({ url: url.trim() });
  if (!request.success) throw new ApiError('VALIDATION_ERROR', '请填写公开的 HTTP(S) 音视频或网页链接', false);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, 180_000);
  try {
    const token = await getInstallationToken();
    controller.signal.throwIfAborted();
    const response = await (Platform.OS === 'web' ? fetch : nativeFetch)(`${getApiBaseUrl()}/v1/speaking/remote-media`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request.data), signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) {
      const failure = ApiError.fromUnknown(await response.json());
      throw new ApiError(failure.code, failure.message.split(token).join('[REDACTED]'), failure.retryable, failure.requestId);
    }
    const type = SpeakingMediaTypeSchema.safeParse(response.headers.get('content-type')?.split(';')[0]);
    if (!type.success) throw new ApiError('INVALID_SERVER_RESPONSE', '链接没有返回可用的音视频', false);
    const bytes = new Uint8Array(await response.arrayBuffer());
    controller.signal.throwIfAborted();
    if (!bytes.byteLength || bytes.byteLength > SPEAKING_MAX_REMOTE_MEDIA_BYTES) {
      throw new ApiError('IMPORT_TOO_LARGE', '网页音视频不能超过 100 MB，大文件请从本地或电脑上传', false);
    }
    return await downloadedSpeakingMedia(bytes, type.data);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK_ERROR', controller.signal.aborted ? '下载已取消或超时，可以重试' : '音视频下载失败，请重试或从本地导入', true);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
