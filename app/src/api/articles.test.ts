import { getInstallationToken } from './installation';
import {
  deleteImportedArticle,
  getImportedArticle,
  listImportedArticles,
} from './articles';

jest.mock('./installation', () => ({ getInstallationToken: jest.fn() }));

const mockedGetInstallationToken = jest.mocked(getInstallationToken);
const fetchMock = jest.fn();
const originalApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const summary = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceKind: 'paste' as const,
  sourceUrl: null,
  title: 'Private article',
  wordCount: 800,
  importedAt: '2026-09-12T08:00:00.000Z',
};

describe('private article API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test/';
    mockedGetInstallationToken.mockResolvedValue('ab'.repeat(32));
    global.fetch = fetchMock as typeof fetch;
  });

  afterAll(() => {
    if (originalApiBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiBaseUrl;
    }
  });

  it('lists a cursor page and reads a full article through strict schemas', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ items: [summary], nextCursor: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          ...summary,
          paragraphs: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              position: 0,
              text: 'Synthetic private article text remains owner scoped.',
            },
          ],
        }),
      });

    await expect(
      listImportedArticles({ limit: 30, cursor: 'next_cursor' }),
    ).resolves.toEqual({ items: [summary], nextCursor: null });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/v1/articles?limit=30&cursor=next_cursor',
      expect.objectContaining({}),
    );
    await expect(getImportedArticle(summary.id)).resolves.toMatchObject({
      id: summary.id,
      paragraphs: [{ position: 0 }],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.example.test/v1/articles/${summary.id}`,
      expect.objectContaining({}),
    );
  });

  it('deletes with a no-content request', async () => {
    const json = jest.fn();
    fetchMock.mockResolvedValue({ ok: true, status: 204, json });
    await expect(deleteImportedArticle(summary.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/v1/articles/${summary.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects malformed list JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        items: [{ ...summary, paragraphs: [] }],
        nextCursor: null,
      }),
    });
    await expect(listImportedArticles()).rejects.toMatchObject({
      code: 'INVALID_SERVER_RESPONSE',
    });
  });

  it('maps a delete error body to ApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: '删除服务暂时不可用',
          requestId: '33333333-3333-4333-8333-333333333333',
          retryable: true,
        },
      }),
    });
    await expect(deleteImportedArticle(summary.id)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
    });
  });
});
