import { AppError } from '../../../../server/src/core/errors';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const BLOCKED_SUFFIXES = [
  '.localhost', '.local', '.internal', '.test', '.invalid', '.example', '.onion',
];

export interface CloudflareFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  signal: AbortSignal;
  maxRedirects?: number;
  requestPage?: typeof fetch;
}

function blocked(): AppError {
  return new AppError('IMPORT_FETCH_BLOCKED', '该网络地址不允许导入', 422);
}

function failed(retryable: boolean): AppError {
  return new AppError('IMPORT_FETCH_FAILED', '网页暂时无法读取', 503, retryable);
}

/**
 * Workers cannot pin a resolved IP for an arbitrary external hostname. The
 * caller-approved egress policy relies on Cloudflare's outbound proxy to deny
 * internal services, while this gate rejects IP literals and private-looking
 * hostnames before *every* request, including every manual redirect.
 */
export function publicHtmlUrl(raw: string | URL): URL {
  let url: URL;
  try {
    const value = raw instanceof URL ? raw.toString() : raw;
    if (value.length > 2_048 || value !== value.trim() || /[\u0000-\u001f\\]/u.test(value)) {
      throw blocked();
    }
    url = new URL(value);
  } catch {
    throw blocked();
  }
  const host = url.hostname.toLowerCase();
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username || url.password || !host || host.endsWith('.') ||
      !host.includes('.') || host.includes(':') ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host) ||
      BLOCKED_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix)) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(host) ||
      (url.port !== '' && url.port !== '80' && url.port !== '443')) {
    throw blocked();
  }
  url.hash = '';
  return url;
}

async function boundedHtml(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader !== null && /^\d+$/u.test(lengthHeader) &&
      Number(lengthHeader) > maxBytes) {
    throw new AppError('IMPORT_TOO_LARGE', '网页内容过大', 413);
  }
  const reader = response.body?.getReader();
  if (!reader) throw failed(false);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new AppError('IMPORT_TOO_LARGE', '网页内容过大', 413);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  signal.throwIfAborted();
  if (total === 0) throw failed(false);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!html.trim()) throw failed(false);
    return html;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw failed(false);
  }
}

export async function safeFetchHtmlOnCloudflare(
  initialUrl: string,
  options: CloudflareFetchOptions,
): Promise<{ finalUrl: string; html: string }> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0 ||
      !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError('Invalid fetch bounds');
  }
  options.signal.throwIfAborted();
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
  const requestPage = options.requestPage ?? fetch;
  const maxRedirects = options.maxRedirects ?? 5;
  let current = publicHtmlUrl(initialUrl);

  for (let redirects = 0; ; redirects += 1) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await requestPage(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-encoding': 'identity',
          'user-agent': 'ContextReaderFetcher/1.0',
        },
      });
    } catch {
      options.signal.throwIfAborted();
      throw failed(true);
    }
    try {
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects >= maxRedirects) throw failed(false);
        const location = response.headers.get('location');
        if (!location) throw failed(false);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw failed(false);
        }
        current = publicHtmlUrl(next);
        continue;
      }
      if (response.status < 200 || response.status > 299) {
        throw failed(response.status >= 500);
      }
      const mediaType = response.headers.get('content-type')
        ?.split(';', 1)[0]?.trim().toLowerCase();
      if (!mediaType || !HTML_MEDIA_TYPES.has(mediaType)) {
        throw new AppError('IMPORT_UNSUPPORTED_TYPE', '网页内容类型不支持', 422);
      }
      return { finalUrl: current.toString(), html: await boundedHtml(response, options.maxBytes, signal) };
    } catch (error) {
      options.signal.throwIfAborted();
      if (error instanceof AppError) throw error;
      throw failed(true);
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }
}
