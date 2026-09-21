import { getInstallationToken } from './installation';
import { apiRequestNoContent, ApiError } from './client';
import {
  createPractice,
  getDashboard,
  getPractice,
  getTranslation,
  getVocabulary,
  createVocabularyItem,
  recordAssistance,
  registerAnonymous,
  requestWordTranslation,
  requestTranslation,
  submitAnswer,
} from './practices';

jest.mock('./installation', () => ({
  getInstallationToken: jest.fn(),
}));

const mockedGetInstallationToken = jest.mocked(getInstallationToken);
const fetchMock = jest.fn();
const originalApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

describe('API client', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test/';
    global.fetch = fetchMock as typeof fetch;
  });

  afterAll(() => {
    if (originalApiBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalApiBaseUrl;
    }
  });

  it('registers anonymously with its installation bearer credential', async () => {
    const token = 'a5'.repeat(32);
    mockedGetInstallationToken.mockResolvedValue(token);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({
        userId: '11111111-1111-4111-8111-111111111111',
        kind: 'guest',
        remainingFreePractices: 3,
      }),
    });

    await expect(registerAnonymous(true)).resolves.toMatchObject({
      kind: 'guest',
      remainingFreePractices: 3,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/auth/anonymous',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ageConfirmed14Plus: true }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = request.headers as Headers;
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('maps a non-success public error envelope to ApiError', async () => {
    mockedGetInstallationToken.mockResolvedValue('b6'.repeat(32));
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({
        error: {
          code: 'RATE_LIMITED',
          message: '请求过于频繁',
          requestId: '22222222-2222-4222-8222-222222222222',
          retryable: true,
        },
      }),
    });

    const error = await registerAnonymous(true).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      message: '请求过于频繁',
      requestId: '22222222-2222-4222-8222-222222222222',
      retryable: true,
    });
  });

  it('reports an HTML gateway failure as temporarily unavailable', async () => {
    mockedGetInstallationToken.mockResolvedValue('ab'.repeat(32));
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: jest.fn().mockRejectedValue(new SyntaxError('HTML')) });
    await expect(registerAnonymous(true)).rejects.toMatchObject({ code: 'SERVER_UNAVAILABLE', retryable: true });
  });

  it('accepts an authenticated 204 response without parsing JSON', async () => {
    mockedGetInstallationToken.mockResolvedValue('ab'.repeat(32));
    const json = jest.fn();
    fetchMock.mockResolvedValue({ ok: true, status: 204, json });

    await expect(
      apiRequestNoContent('/v1/articles/id', {
        method: 'DELETE',
      }),
    ).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects a malformed success body with a stable public client error', async () => {
    mockedGetInstallationToken.mockResolvedValue('c7'.repeat(32));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ kind: 'guest' }),
    });

    await expect(registerAnonymous(true)).rejects.toMatchObject({
      code: 'INVALID_SERVER_RESPONSE',
      message: '服务返回了无法识别的数据',
      retryable: true,
    });
  });

  it('redacts the installation token from network failures', async () => {
    const token = 'd8'.repeat(32);
    mockedGetInstallationToken.mockResolvedValue(token);
    fetchMock.mockRejectedValue(new Error(`failed with Bearer ${token}`));

    const error = await registerAnonymous(true).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'NETWORK_ERROR',
      message: '网络连接失败',
      retryable: true,
    });
    expect(String(error)).not.toContain(token);
  });

  it('redacts the installation token if a server error echoes it', async () => {
    const token = 'da'.repeat(32);
    mockedGetInstallationToken.mockResolvedValue(token);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({
        error: {
          code: 'VALIDATION_ERROR',
          message: `无效凭据 ${token}`,
          requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          retryable: false,
        },
      }),
    });

    const error = await registerAnonymous(true).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(String(error)).not.toContain(token);
  });

  it('maps unreadable JSON to a token-free server response error', async () => {
    const token = 'e9'.repeat(32);
    mockedGetInstallationToken.mockResolvedValue(token);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new Error(`parse failed for ${token}`)),
    });

    const error = await registerAnonymous(true).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'INVALID_SERVER_RESPONSE',
      message: '服务返回了无法识别的数据',
      retryable: true,
    });
    expect(String(error)).not.toContain(token);
  });

  it('fails clearly before authentication when the public API URL is absent', async () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    await expect(registerAnonymous(true)).rejects.toMatchObject({
      code: 'API_NOT_CONFIGURED',
      message: '尚未配置服务地址',
      retryable: false,
    });
    expect(mockedGetInstallationToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a practice with the caller-retained idempotency key', async () => {
    mockedGetInstallationToken.mockResolvedValue('fa'.repeat(32));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 202,
      json: jest.fn().mockResolvedValue({
        practiceId: '33333333-3333-4333-8333-333333333333',
        status: 'queued',
        remainingFreePractices: 2,
        pollAfterMs: 1_000,
      }),
    });
    const idempotencyKey = 'retained_create_key_123';
    const request = {
      items: [{ term: 'resilient', meaningZh: '有韧性的' }],
    };

    await expect(createPractice(request, idempotencyKey)).resolves.toMatchObject({
      status: 'queued',
      remainingFreePractices: 2,
    });
    await expect(createPractice(request, idempotencyKey)).resolves.toMatchObject({
      status: 'queued',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/practices',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sentKeys = fetchMock.mock.calls.map(([, init]) =>
      ((init as RequestInit).headers as Headers).get('Idempotency-Key'),
    );
    expect(sentKeys).toEqual([idempotencyKey, idempotencyKey]);
  });

  it('requests a server-side random vocabulary selection with an adjustable count', async () => {
    mockedGetInstallationToken.mockResolvedValue('fb'.repeat(32));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 202,
      json: jest.fn().mockResolvedValue({
        practiceId: '34343434-3434-4434-8434-343434343434',
        status: 'queued',
        remainingFreePractices: 2,
        pollAfterMs: 1_500,
      }),
    });
    const request = { source: 'vocabulary' as const, targetCount: 16 };

    await expect(
      createPractice(request, 'random_vocabulary_key_123'),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/practices',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
  });

  it('loads a practice through its validated durable resource route', async () => {
    mockedGetInstallationToken.mockResolvedValue('0b'.repeat(32));
    const practiceId = '44444444-4444-4444-8444-444444444444';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        id: practiceId,
        status: 'generating',
        modelName: null,
        remainingFreePractices: 2,
        pollAfterMs: 1_000,
        failure: null,
        article: null,
        questions: [],
      }),
    });

    await expect(getPractice(practiceId)).resolves.toMatchObject({
      id: practiceId,
      status: 'generating',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/v1/practices/${practiceId}`,
      expect.objectContaining({}),
    );
  });

  it('requests a translation with the caller-retained idempotency key', async () => {
    mockedGetInstallationToken.mockResolvedValue('1c'.repeat(32));
    const practiceId = '55555555-5555-4555-8555-555555555555';
    const paragraphId = '66666666-6666-4666-8666-666666666666';
    const idempotencyKey = 'retained_translation_key_123';
    const request = { scope: 'paragraph' as const, paragraphId };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 202,
      json: jest.fn().mockResolvedValue({
        id: '77777777-7777-4777-8777-777777777777',
        status: 'queued',
        scope: 'paragraph',
        paragraphId,
        translatedTextZh: null,
        pollAfterMs: 1_000,
        failure: null,
      }),
    });

    await expect(
      requestTranslation(practiceId, request, idempotencyKey),
    ).resolves.toMatchObject({ status: 'queued', scope: 'paragraph' });

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/v1/practices/${practiceId}/translations`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Headers).get('Idempotency-Key')).toBe(
      idempotencyKey,
    );
  });

  it('loads and validates a durable translation resource', async () => {
    mockedGetInstallationToken.mockResolvedValue('2d'.repeat(32));
    const translationId = '88888888-8888-4888-8888-888888888888';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        id: translationId,
        status: 'ready',
        scope: 'full',
        paragraphId: null,
        translatedTextZh: '已经完成的译文',
        failure: null,
      }),
    });

    await expect(getTranslation(translationId)).resolves.toMatchObject({
      id: translationId,
      status: 'ready',
      translatedTextZh: '已经完成的译文',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/v1/translations/${translationId}`,
      expect.objectContaining({}),
    );
  });

  it('records displayed assistance with the retained evidence key', async () => {
    mockedGetInstallationToken.mockResolvedValue('3e'.repeat(32));
    const practiceId = '99999999-9999-4999-8999-999999999999';
    const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const idempotencyKey = 'retained_assistance_key_123';
    const request = { kind: 'word_hint' as const, targetId };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        recorded: true,
        hintMeaningZh: '有韧性的',
      }),
    });

    await expect(
      recordAssistance(practiceId, request, idempotencyKey),
    ).resolves.toEqual({ recorded: true, hintMeaningZh: '有韧性的' });

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/v1/practices/${practiceId}/assistance`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Headers).get('Idempotency-Key')).toBe(
      idempotencyKey,
    );
  });

  it('looks up a selected word locally without authentication or a translation request', async () => {
    const request = {
      term: 'resilient',
      context: 'A resilient reader updates context.',
    };
    await expect(requestWordTranslation(request)).resolves.toMatchObject({
      term: request.term,
      partOfSpeech: 'adj.',
      meaningZh: expect.stringContaining('有弹性的'),
    });
    await expect(requestWordTranslation({ term: 'zzmissingwordzz' })).rejects.toThrow('本地词典未收录这个词');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedGetInstallationToken).not.toHaveBeenCalled();
  });

  it('saves a selected word as an idempotent vocabulary item', async () => {
    mockedGetInstallationToken.mockResolvedValue('4a'.repeat(32));
    const idempotencyKey = 'word-card-client-key-1';
    const request = {
      term: 'resilient',
      meaningZh: '有韧性的；能复原的',
      sourceSentence: 'A resilient reader updates context.',
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        ...request,
        status: 'pending',
        practiceCount: 0,
        firstTryCorrectCount: 0,
        assistedCount: 0,
        lastPracticedAt: null,
      }),
    });

    await expect(createVocabularyItem(request, idempotencyKey)).resolves.toMatchObject({
      term: request.term,
      meaningZh: request.meaningZh,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Headers).get('Idempotency-Key')).toBe(idempotencyKey);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/vocabulary-items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
  });

  it('submits a first answer with the caller-retained idempotency key', async () => {
    mockedGetInstallationToken.mockResolvedValue('4f'.repeat(32));
    const practiceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const questionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const correctOptionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const idempotencyKey = 'retained_answer_key_123';
    const request = {
      answerKind: 'dont_know' as const,
      questionId,
      elapsedMs: 5_000,
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        answerKind: 'dont_know',
        selectedOptionId: null,
        isCorrect: false,
        wasAssisted: false,
        correctOptionId,
        meaningEn: 'able to recover quickly',
        explanationZh: '该词表示快速恢复。',
        optionExplanations: {
          [correctOptionId]: '这是正确义项。',
        },
      }),
    });

    await expect(
      submitAnswer(practiceId, request, idempotencyKey),
    ).resolves.toMatchObject({ answerKind: 'dont_know', isCorrect: false });

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/v1/practices/${practiceId}/answers`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Headers).get('Idempotency-Key')).toBe(
      idempotencyKey,
    );
  });

  it('loads a cursor page with encoded vocabulary query parameters', async () => {
    mockedGetInstallationToken.mockResolvedValue('50'.repeat(32));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    });

    await expect(
      getVocabulary({ cursor: 'next+cursor/value', limit: 50 }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/vocabulary-items?cursor=next%2Bcursor%2Fvalue&limit=50',
      expect.objectContaining({}),
    );
  });

  it('loads and validates the dashboard summary', async () => {
    mockedGetInstallationToken.mockResolvedValue('61'.repeat(32));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        incompletePracticeId: null,
        vocabularyCount: 4,
        reviewingCount: 2,
        dueLearningCount: 2,
        unlearnedCount: 1,
        todayAddedCount: 1,
        completedPracticeCount: 1,
        remainingFreePractices: 2,
      }),
    });

    await expect(getDashboard()).resolves.toEqual({
      incompletePracticeId: null,
      vocabularyCount: 4,
      reviewingCount: 2,
      dueLearningCount: 2,
      unlearnedCount: 1,
      todayAddedCount: 1,
      completedPracticeCount: 1,
      remainingFreePractices: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/v1/dashboard?${new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).toString()}`,
      expect.objectContaining({}),
    );
  });
});
