import { describe, expect, it, vi } from 'vitest';

import {
  safeFetchHtml,
  type PageResponse,
  type RequestPinnedPage,
} from './safe-fetch';
import type { ResolveHost } from './url-policy';

describe('safe bounded HTML fetching', () => {
  it('resolves and pins every redirect hop with fixed request boundaries', async () => {
    const resolveHost: ResolveHost = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }]);
    const requestPage: RequestPinnedPage = vi
      .fn()
      .mockResolvedValueOnce(response(302, '', { location: '/final' }))
      .mockResolvedValueOnce(
        response(200, '<html><body>Original safe page</body></html>', {
          'content-type': 'text/html; charset=utf-8',
        }),
      );

    await expect(
      safeFetchHtml('https://example.com/start', {
        maxBytes: 5_242_880,
        timeoutMs: 15_000,
        resolveHost,
        requestPage,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      finalUrl: 'https://example.com/final',
      html: '<html><body>Original safe page</body></html>',
    });
    expect(resolveHost).toHaveBeenCalledTimes(2);
    expect(requestPage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ address: '93.184.216.34' }),
      expect.any(AbortSignal),
    );
    expect(requestPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ address: '93.184.216.35' }),
      expect.any(AbortSignal),
    );
  });

  it('blocks DNS rebinding before issuing a second request', async () => {
    const resolveHost: ResolveHost = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const requestPage: RequestPinnedPage = vi
      .fn()
      .mockResolvedValue(response(302, '', { location: '/next' }));
    await expect(
      safeFetchHtml('https://example.com/start', {
        maxBytes: 100,
        timeoutMs: 15_000,
        resolveHost,
        requestPage,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_FETCH_BLOCKED' });
    expect(requestPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'wrong MIME',
      page: response(200, 'plain text', { 'content-type': 'text/plain' }),
      code: 'IMPORT_UNSUPPORTED_TYPE',
    },
    {
      name: 'non-success status',
      page: response(503, 'unavailable', { 'content-type': 'text/html' }),
      code: 'IMPORT_FETCH_FAILED',
    },
    {
      name: 'missing redirect location',
      page: response(302, ''),
      code: 'IMPORT_FETCH_FAILED',
    },
  ])('fails safely for $name', async ({ page, code }) => {
    await expect(fetchOne(page, 100)).rejects.toMatchObject({ code });
  });

  it('rejects responses above the exact byte ceiling', async () => {
    await expect(
      fetchOne(
        response(200, 'x'.repeat(5_242_881), {
          'content-type': 'application/xhtml+xml',
        }),
        5_242_880,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_TOO_LARGE' });
  });

  it('allows at most five redirects and preserves an outer abort', async () => {
    const redirect: RequestPinnedPage = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(response(302, '', { location: '/again' })),
      );
    await expect(
      safeFetchHtml('https://example.com/start', {
        maxBytes: 100,
        timeoutMs: 15_000,
        resolveHost: publicResolver,
        requestPage: redirect,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_FETCH_FAILED' });
    expect(redirect).toHaveBeenCalledTimes(6);

    const controller = new AbortController();
    controller.abort();
    await expect(
      safeFetchHtml('https://example.com/start', {
        maxBytes: 100,
        timeoutMs: 15_000,
        resolveHost: publicResolver,
        requestPage: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

const publicResolver: ResolveHost = async () => [
  { address: '93.184.216.34', family: 4 },
];

function fetchOne(page: PageResponse, maxBytes: number) {
  return safeFetchHtml('https://example.com/story', {
    maxBytes,
    timeoutMs: 15_000,
    resolveHost: publicResolver,
    requestPage: async () => page,
    signal: new AbortController().signal,
  });
}

function response(
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
): PageResponse {
  return {
    statusCode,
    headers,
    body: {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body, 'utf8');
      },
    },
    close: vi.fn().mockResolvedValue(undefined),
  };
}
