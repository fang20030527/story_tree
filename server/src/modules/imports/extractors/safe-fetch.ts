import { Agent, request } from 'undici';

import { AppError } from '../../../core/errors';
import {
  resolveSafeHttpTarget,
  resolveWithNode,
  type ResolveHost,
  type SafeHttpTarget,
} from './url-policy';

export interface PageResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

export type RequestPinnedPage = (
  target: SafeHttpTarget,
  signal: AbortSignal,
) => Promise<PageResponse>;

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  resolveHost?: ResolveHost;
  requestPage?: RequestPinnedPage;
  signal: AbortSignal;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export async function safeFetchHtml(
  initialUrl: string,
  options: SafeFetchOptions,
): Promise<{ finalUrl: string; html: string }> {
  options.signal.throwIfAborted();
  const maxRedirects = options.maxRedirects ?? 5;
  const resolveHost = options.resolveHost ?? resolveWithNode;
  const requestPage = options.requestPage ?? requestPinnedPage;
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = AbortSignal.any([options.signal, timeoutSignal]);
  let current = initialUrl;
  let redirects = 0;

  while (true) {
    options.signal.throwIfAborted();
    let response: PageResponse | undefined;
    try {
      const target = await resolveSafeHttpTarget(current, resolveHost);
      response = await requestPage(target, signal);
      if (REDIRECT_STATUSES.has(response.statusCode)) {
        if (redirects >= maxRedirects) {
          throw fetchFailure(false);
        }
        const location = firstHeader(response.headers.location);
        if (!location) throw fetchFailure(false);
        try {
          current = new URL(location, target.url).toString();
        } catch {
          throw fetchFailure(false);
        }
        redirects += 1;
        continue;
      }
      if (response.statusCode < 200 || response.statusCode > 299) {
        throw fetchFailure(response.statusCode >= 500);
      }
      const mediaType = firstHeader(response.headers['content-type'])
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (!mediaType || !HTML_MEDIA_TYPES.has(mediaType)) {
        throw new AppError(
          'IMPORT_UNSUPPORTED_TYPE',
          '网页内容类型不支持',
          422,
        );
      }
      const content = await readBoundedBody(
        response.body,
        options.maxBytes,
        signal,
      );
      let html: string;
      try {
        html = new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch {
        throw fetchFailure(false);
      }
      if (!html.trim()) throw fetchFailure(false);
      return { finalUrl: target.url.toString(), html };
    } catch (error) {
      if (options.signal.aborted) {
        options.signal.throwIfAborted();
      }
      if (error instanceof AppError) throw error;
      throw fetchFailure(true);
    } finally {
      await response?.close();
    }
  }
}

const requestPinnedPage: RequestPinnedPage = async (target, signal) => {
  const dispatcher = new Agent({
    connections: 1,
    connect: {
      lookup(_hostname, _options, callback) {
        callback(null, target.address, target.family);
      },
    },
  });
  try {
    const requestOptions = {
      dispatcher,
      method: 'GET',
      maxRedirections: 0,
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
      signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-encoding': 'identity',
        'user-agent': 'ContextReaderFetcher/1.0',
      },
    } as const;
    const response = await request(target.url, requestOptions);
    return {
      statusCode: response.statusCode,
      headers: response.headers as Record<
        string,
        string | string[] | undefined
      >,
      body: response.body,
      close: async () => dispatcher.destroy(),
    };
  } catch (error) {
    await dispatcher.destroy();
    throw error;
  }
};

async function readBoundedBody(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const rawChunk of body) {
    signal.throwIfAborted();
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    byteSize += chunk.byteLength;
    if (byteSize > maxBytes) {
      throw new AppError('IMPORT_TOO_LARGE', '网页内容过大', 413);
    }
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  if (byteSize === 0) throw fetchFailure(false);
  return Buffer.concat(chunks);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function fetchFailure(retryable: boolean): AppError {
  return new AppError('IMPORT_FETCH_FAILED', '网页暂时无法读取', 503, retryable);
}
