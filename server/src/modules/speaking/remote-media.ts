import { fileTypeFromBuffer } from 'file-type';
import { parseHTML } from 'linkedom';
import { SPEAKING_MAX_REMOTE_MEDIA_BYTES, SpeakingMediaTypeSchema } from '@context-reader/contracts';
import { AppError } from '../../core/errors';

export interface RemoteMediaResponse {
  response: Response;
  url: URL;
  close(): Promise<void>;
}
/** 每次调用都必须验证目标地址；调用方实现 DNS 锁定或 Workers 出站策略。 */
export type OpenSpeakingRemoteUrl = (url: string, signal: AbortSignal) => Promise<RemoteMediaResponse>;
const redirects = new Set([301, 302, 303, 307, 308]);
const HTML_BYTES = 1024 * 1024;
const SAMPLE_BYTES = 65_536;

function failed() { return new AppError('IMPORT_FETCH_FAILED', '链接暂时无法读取，请重试或从本地导入', 503, true); }
function unsupported() { return new AppError('IMPORT_UNSUPPORTED_TYPE', '该链接没有可直接下载的音视频，请先下载文件，再从本地或网盘导入', 422); }
function tooLarge() { return new AppError('IMPORT_TOO_LARGE', '网页音视频不能超过 100 MB，大文件请从本地或电脑上传', 413); }
function mediaType(value: string) {
  const aliases: Record<string, string> = { 'audio/x-m4a': 'audio/mp4', 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav' };
  return aliases[value] ?? value;
}

async function openWithRedirects(url: string, open: OpenSpeakingRemoteUrl, signal: AbortSignal) {
  let current = url;
  for (let count = 0; ; count++) {
    signal.throwIfAborted();
    const result = await open(current, signal);
    if (!redirects.has(result.response.status)) {
      if (!result.response.ok) { await result.close(); throw failed(); }
      return result;
    }
    try {
      const location = result.response.headers.get('location');
      if (!location || count >= 5) throw failed();
      current = new URL(location, result.url).toString();
    } finally { await result.close(); }
  }
}

async function pageMedia(result: RemoteMediaResponse, signal: AbortSignal): Promise<string> {
  const reader = result.response.body?.getReader();
  if (!reader) throw unsupported();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > HTML_BYTES) throw new AppError('IMPORT_TOO_LARGE', '网页内容过大，请粘贴音视频文件的下载链接', 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const { document } = parseHTML(new TextDecoder().decode(bytes));
    const candidates = [
      ...Array.from(document.querySelectorAll('audio[src], video[src], audio source[src], video source[src]')).map(node => node.getAttribute('src')),
      ...Array.from(document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:audio"], meta[property="og:audio:url"], meta[name="twitter:player:stream"]')).map(node => node.getAttribute('content')),
    ];
    for (const candidate of candidates) {
      if (!candidate?.trim()) continue;
      let url: URL;
      try { url = new URL(candidate.trim(), result.url); } catch { continue; }
      if (['http:', 'https:'].includes(url.protocol) && !/\.(?:m3u8|mpd)(?:$|\?)/iu.test(url.pathname)) return url.toString();
    }
    throw unsupported();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); await result.close(); }
}

/** 返回受大小与时间限制的二进制流，不向客户端暴露源地址、Cookie 或响应头。 */
export async function fetchSpeakingRemoteMedia(url: string, open: OpenSpeakingRemoteUrl, callerSignal: AbortSignal): Promise<Response> {
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(180_000)]);
  let result: RemoteMediaResponse | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    result = await openWithRedirects(url, open, signal);
    const type = result.response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (type === 'text/html' || type === 'application/xhtml+xml') {
      const source = await pageMedia(result, signal);
      result = await openWithRedirects(source, open, signal);
    }
    const declaredType = mediaType(result.response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '');
    if (!SpeakingMediaTypeSchema.safeParse(declaredType).success && declaredType !== 'application/octet-stream') throw unsupported();
    const lengthHeader = result.response.headers.get('content-length');
    const expectedSize = lengthHeader && /^\d+$/u.test(lengthHeader) ? Number(lengthHeader) : null;
    if (expectedSize !== null && (expectedSize > SPEAKING_MAX_REMOTE_MEDIA_BYTES || expectedSize <= 0)) throw tooLarge();
    reader = result.response.body?.getReader();
    if (!reader) throw unsupported();
    let total = 0;
    let ended = false;
    const prefix: Uint8Array[] = [];
    while (total < SAMPLE_BYTES) {
      signal.throwIfAborted();
      const item = await reader.read();
      if (item.done) { ended = true; break; }
      total += item.value.byteLength;
      if (total > SPEAKING_MAX_REMOTE_MEDIA_BYTES) throw tooLarge();
      prefix.push(item.value);
    }
    const sample = new Uint8Array(Math.min(total, SAMPLE_BYTES));
    let offset = 0;
    for (const chunk of prefix) {
      const slice = chunk.subarray(0, sample.byteLength - offset);
      sample.set(slice, offset); offset += slice.byteLength;
      if (offset === sample.byteLength) break;
    }
    const detected = await fileTypeFromBuffer(sample).catch(() => undefined);
    const contentType = detected && mediaType(detected.mime);
    if (!SpeakingMediaTypeSchema.safeParse(contentType).success ||
        declaredType !== 'application/octet-stream' && declaredType !== contentType &&
        !(declaredType === 'audio/webm' && contentType === 'video/webm')) throw unsupported();
    const finalReader = reader;
    const finalResult = result;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', abort);
      await finalReader.cancel().catch(() => undefined);
      finalReader.releaseLock();
      await finalResult.close();
    };
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const abort = () => { streamController.error(failed()); void close(); };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); },
      async pull(controller) {
        try {
          signal.throwIfAborted();
          const chunk = prefix.shift();
          if (chunk) { controller.enqueue(chunk); return; }
          if (!ended) {
            const item = await finalReader.read();
            if (!item.done) {
              total += item.value.byteLength;
              if (total > SPEAKING_MAX_REMOTE_MEDIA_BYTES) throw tooLarge();
              controller.enqueue(item.value); return;
            }
            ended = true;
          }
          if (total === 0 || expectedSize !== null && total !== expectedSize) throw failed();
          await close(); controller.close();
        } catch { if (!closed) { controller.error(failed()); await close(); } }
      },
      async cancel() { await close(); },
    });
    return new Response(stream, { headers: { 'content-type': declaredType === 'audio/webm' ? declaredType : contentType!,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
    await result?.close();
    if (error instanceof AppError) throw error;
    throw failed();
  }
}
