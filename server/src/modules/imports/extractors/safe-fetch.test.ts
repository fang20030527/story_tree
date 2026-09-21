import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import {
  requestPinnedPage,
  safeFetchHtml,
  type PageResponse,
  type RequestPinnedPage,
} from './safe-fetch';
import type { ResolveHost } from './url-policy';
import { extractReadableHtml } from './html';

describe('safe bounded HTML fetching', () => {
  it('recognizes the Eudic share-to-course redirect chain instead of importing the sales page', async () => {
    const requestPage: RequestPinnedPage = vi.fn()
      .mockResolvedValueOnce(response(302, '', { location: 'https://dict.eudic.net/webting/play?id=article&app=Ting' }))
      .mockResolvedValueOnce(response(302, '', { location: '/courses/detail/course?pids=' }))
      .mockResolvedValueOnce(response(200, '<html><body>精听党 | 每日外刊 立即报名</body></html>', { 'content-type': 'text/html' }));
    const page = await safeFetchHtml('https://cn.eudic.net/ting/openArticle?id=article', {
      maxBytes: 1_024,
      timeoutMs: 1_000,
      resolveHost: publicResolver,
      requestPage,
      signal: new AbortController().signal,
    });
    expect(page.finalUrl).toBe('https://dict.eudic.net/courses/detail/course?pids=');
    expect(() => extractReadableHtml(page.html, page.finalUrl)).toThrow(
      expect.objectContaining({ code: 'IMPORT_SOURCE_REQUIRES_ACCESS', retryable: false }),
    );
    expect(requestPage).toHaveBeenCalledTimes(3);
  });

  it('connects to the single pinned address on auto-family runtimes', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body>Pinned page</body></html>');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const page = await requestPinnedPage(
        {
          url: new URL(`http://publisher.example:${address.port}/story`),
          address: '127.0.0.1',
          family: 4,
        },
        AbortSignal.timeout(1_000),
      );
      try {
        expect(page.statusCode).toBe(200);
        await expect(readBody(page.body)).resolves.toContain('Pinned page');
      } finally {
        await page.close();
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

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

async function readBody(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
