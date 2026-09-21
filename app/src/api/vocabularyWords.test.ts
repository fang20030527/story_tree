import { getInstallationToken } from './installation';
import {
  getVocabulary,
  getVocabularyWordContexts,
  getVocabularyWords,
  markVocabularyWordMastered,
  restoreVocabularyWord,
} from './practices';

jest.mock('./installation', () => ({ getInstallationToken: jest.fn() }));

const fetchMock = jest.fn();
const originalApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const originalFetch = global.fetch;
const wordId = '11111111-1111-4111-8111-111111111111';
const word = {
  wordId, term: 'bank', meaningZh: '银行', sourceSentence: null,
  contextCount: 2, reviewReason: 'new', nextReviewAt: '2026-09-14T12:00:00.000Z',
  practiceCount: 0, independentCorrectCount: 0, assistedCount: 0, lastPracticedAt: null,
  masteredAt: null,
};
const summary = {
  totalCount: 80, todayCount: 5, learningCount: 30,
  dueLearningCount: 12, unlearnedCount: 45, masteredCount: 5,
};
const page = {
  items: [word], nextCursor: 'more', evaluatedAt: '2026-09-14T12:00:00.000Z', nextRefreshAt: null,
  summary,
};
const success = (body: unknown) => ({ ok: true, status: 200, json: jest.fn().mockResolvedValue(body) });

beforeEach(() => {
  jest.resetAllMocks();
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test/';
  jest.mocked(getInstallationToken).mockResolvedValue('ab'.repeat(32));
  global.fetch = fetchMock as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
  if (originalApiBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalApiBaseUrl;
});

it('requests a server-filtered word page with a safely encoded cursor', async () => {
  fetchMock.mockResolvedValueOnce(success(page));
  await expect(getVocabularyWords({ filter: 'due', cursor: 'opaque+/=?', limit: 30 })).resolves.toEqual(page);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.example.test/v1/vocabulary-words?filter=due&cursor=opaque%2B%2F%3D%3F&limit=30',
    expect.objectContaining({}),
  );
});

it('passes the new category filter and IANA time zone to the server', async () => {
  fetchMock.mockResolvedValueOnce(success(page));
  await expect(getVocabularyWords({ filter: 'today', timeZone: 'Asia/Shanghai', limit: 30 })).resolves.toEqual(page);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.example.test/v1/vocabulary-words?filter=today&timeZone=Asia%2FShanghai&limit=30',
    expect.objectContaining({}),
  );
});

it('marks a word mastered with a retained idempotency key', async () => {
  const mastery = { wordId, masteredAt: '2026-09-14T12:30:00.000Z' };
  fetchMock.mockResolvedValueOnce(success(mastery));
  await expect(markVocabularyWordMastered(wordId, 'mastery-key-1')).resolves.toEqual(mastery);
  expect(fetchMock).toHaveBeenCalledWith(
    `https://api.example.test/v1/vocabulary-words/${wordId}/mastered`,
    expect.objectContaining({ method: 'POST', body: '{}' }),
  );
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect((init.headers as Headers).get('Idempotency-Key')).toBe('mastery-key-1');
});

it('restores a mastered word with a retained idempotency key', async () => {
  const mastery = { wordId, masteredAt: null };
  fetchMock.mockResolvedValueOnce(success(mastery));
  await expect(restoreVocabularyWord(wordId, 'restore-key-1')).resolves.toEqual(mastery);
  expect(fetchMock).toHaveBeenCalledWith(
    `https://api.example.test/v1/vocabulary-words/${wordId}/unmaster`,
    expect.objectContaining({ method: 'POST', body: '{}' }),
  );
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect((init.headers as Headers).get('Idempotency-Key')).toBe('restore-key-1');
});

it('loads all saved contexts for one word through the context schema', async () => {
  const contexts = { wordId, contexts: [
    { id: '22222222-2222-4222-8222-222222222222', meaningZh: '银行', sourceSentence: null },
    { id: '33333333-3333-4333-8333-333333333333', meaningZh: '河岸', sourceSentence: 'The river bank.' },
  ] };
  fetchMock.mockResolvedValueOnce(success(contexts));
  await expect(getVocabularyWordContexts(wordId)).resolves.toEqual(contexts);
  expect(fetchMock).toHaveBeenCalledWith(
    `https://api.example.test/v1/vocabulary-words/${wordId}/contexts`, expect.objectContaining({}),
  );
});

it('rejects malformed word responses instead of presenting inaccurate counts', async () => {
  fetchMock.mockResolvedValueOnce(success({ ...page, summary: { dueCount: 1 } }));
  await expect(getVocabularyWords()).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
});

it('preserves a stale-cursor error code for first-page recovery', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false, status: 409,
    json: jest.fn().mockResolvedValue({ error: { code: 'VOCABULARY_CHANGED', message: '词库已更新，请刷新', requestId: wordId, retryable: true } }),
  });
  await expect(getVocabularyWords({ cursor: 'old' })).rejects.toMatchObject({ code: 'VOCABULARY_CHANGED' });
});

it('retains the existing per-context vocabulary endpoint for older consumers', async () => {
  fetchMock.mockResolvedValueOnce(success({ items: [], nextCursor: null }));
  await expect(getVocabulary()).resolves.toEqual({ items: [], nextCursor: null });
  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/v1/vocabulary-items', expect.objectContaining({}));
});
