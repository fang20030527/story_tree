import { SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES } from '@context-reader/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../core/errors';
import { SpeechaceProvider, type PronunciationProvider, type SpeechaceRegion } from './speechace';

const apiKey = 'test-secret?+&=key';
const input: Parameters<PronunciationProvider['assess']>[0] = {
  audio: new Uint8Array([1, 2, 3, 4]), contentType: 'audio/webm;codecs=opus',
  referenceText: 'A thing.', locale: 'en-us',
};

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Speechace Basic 发音评测适配器', () => {
  it('提交 Basic multipart，保留音频字节，不将字幕或音频放入 URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody()));
    const provider = new SpeechaceProvider({ apiKey, fetch: fetchImpl });
    const result = await provider.assess(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(requestUrl));
    expect(url.origin).toBe('https://api2.speechace.com');
    expect(url.pathname).toBe('/api/scoring/text/v9/json');
    expect([...url.searchParams.keys()].sort()).toEqual(['dialect', 'key']);
    expect(url.searchParams.get('key')).toBe(apiKey);
    expect(url.searchParams.get('dialect')).toBe('en-us');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect([...form.keys()].sort()).toEqual(['no_mc', 'text', 'user_audio_file']);
    expect(form.get('no_mc')).toBe('1');
    expect(form.get('text')).toBe(input.referenceText);
    const audio = form.get('user_audio_file');
    expect(audio).toBeInstanceOf(Blob);
    if (!audio || typeof audio === 'string') throw new Error('测试缺少音频文件');
    expect(audio.name).toBe('recording.webm');
    expect(audio.type).toBe('audio/webm');
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(input.audio);
    expect(result).toEqual({
      score: 88.25,
      words: [{
        word: 'thing', score: 61.5, startMs: 250, endMs: 600,
        phonemes: [
          { symbol: 'θ', spokenSymbol: 's', score: 35, stressScore: null, startMs: 250, endMs: 350 },
          { symbol: 'ɪ', spokenSymbol: 'ɪ', score: 87, stressScore: 65, startMs: 350, endMs: 410 },
          { symbol: 'ŋ', spokenSymbol: null, score: 95, stressScore: null, startMs: 410, endMs: 600 },
        ],
      }],
      feedback: ['「thing」中的 /θ/ 更接近 /s/，请听示范后重点练习 /θ/。'],
    });
  });

  it.each<[SpeechaceRegion, string]>([
    ['us-west', 'https://api.speechace.co'], ['ap-southeast', 'https://api2.speechace.com'],
    ['eu-west', 'https://api4.speechace.com'], ['ap-south', 'https://api5.speechace.com'],
  ])('只使用 %s 官方区域端点', async (region, endpoint) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody()));
    await new SpeechaceProvider({ apiKey, region, fetch: fetchImpl }).assess({ ...input, locale: 'en-gb' });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.origin).toBe(endpoint);
    expect(url.searchParams.get('dialect')).toBe('en-gb');
  });

  it.each(['audio/mp4', 'audio/x-m4a', 'audio/m4a'])('将 %s 录音按 M4A 文件提交', async contentType => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody()));
    await new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess({ ...input, contentType });
    const form = fetchImpl.mock.calls[0]![1]!.body as FormData;
    const audio = form.get('user_audio_file');
    if (!audio || typeof audio === 'string') throw new Error('测试缺少音频文件');
    expect(audio.name).toBe('recording.m4a');
    expect(audio.type).toBe(contentType);
  });

  it('缺失词、音素分数和时间保留 null，真实零分仍保留 0', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody({
      speechace_score: { pronunciation: 0 },
      word_score_list: [
        { word: 'missing', phone_score_list: [{ phone: 'th' }] },
        { word: 'zero', quality_score: 0, phone_score_list: [{ phone: 'z', quality_score: 0, stress_score: 0 }] },
        { word: 'unavailable', quality_score: null },
      ],
    })));
    const result = await new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input);
    expect(result.score).toBe(0);
    expect(result.words[0]).toEqual({ word: 'missing', score: null, startMs: null, endMs: null,
      phonemes: [{ symbol: 'θ', spokenSymbol: null, score: null, stressScore: null, startMs: null, endMs: null }] });
    expect(result.words[1]).toMatchObject({ score: 0, phonemes: [{ score: 0, stressScore: 0 }] });
    expect(result.words[2]).toEqual({ word: 'unavailable', score: null, startMs: null, endMs: null, phonemes: [] });
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0]).toContain('zero');
  });

  it('使用上游句子 quality_score 作为兼容字段，不自行合成句子分数', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody({
      speechace_score: undefined, quality_score: 72.75,
    })));
    expect((await new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).score).toBe(72.75);
  });

  it('根据口音映射真实音素，正确区分弱读元音且不捏造替换音', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody({
      word_score_list: [{ word: 'ago', quality_score: 65, phone_score_list: [
        { phone: 'ah', stress_level: 0, quality_score: 65, sound_most_like: 'ah' },
        { phone: 'ow', quality_score: 99, sound_most_like: 'ow' },
      ] }],
    })));
    const result = await new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess({ ...input, locale: 'en-gb' });
    expect(result.words[0]?.phonemes).toMatchObject([
      { symbol: 'ə', spokenSymbol: 'ə' }, { symbol: 'əʊ', spokenSymbol: 'əʊ' },
    ]);
    expect(result.feedback[0]).toContain('/ə/');
    expect(result.feedback[0]).not.toContain('更接近');
  });

  it('中文反馈只来自实际低分词或音素，最多三条', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody({
      word_score_list: [
        { word: 'stress', quality_score: 90, phone_score_list: [{ phone: 'eh', stress_score: 55 }] },
        { word: 'sound', quality_score: null, phone_score_list: [{ phone: 's', quality_score: 65 }] },
        { word: 'word', quality_score: 70 },
        { word: 'fourth', quality_score: 60 },
        { word: 'clear', quality_score: 95 },
      ],
    })));
    const result = await new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input);
    expect(result.feedback).toHaveLength(3);
    expect(result.feedback.some(value => value.includes('重音'))).toBe(true);
    expect(result.feedback.join('')).not.toContain('clear');
    expect(result.feedback.join('')).not.toContain('sound');
  });

  it('没有低分证据时不生成纠音提示', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody({
      word_score_list: [{ word: 'clear', quality_score: 95 }, { word: 'unknown' }],
    })));
    const result = await new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input);
    expect(result.feedback).toEqual([]);
  });

  it.each([
    { speechace_score: { pronunciation: -1 } },
    { speechace_score: { pronunciation: 101 } },
    { speechace_score: { pronunciation: '80' } },
    { speechace_score: { pronunciation: null } },
    { speechace_score: undefined },
    { word_score_list: [] },
    { word_score_list: [{ word: 'bad', quality_score: 101 }] },
    { word_score_list: [{ word: 'bad', quality_score: '80' }] },
    { word_score_list: [{ word: 'bad', phone_score_list: [{ phone: 's', quality_score: -1 }] }] },
    { word_score_list: [{ word: 'bad', phone_score_list: [{ phone: 's', stress_score: 101 }] }] },
    { word_score_list: [{ word: 'bad', phone_score_list: [{ phone: 's', extent: [20, 10] }] }] },
    { word_score_list: [{ word: 'bad', phone_score_list: [{ phone: 's', extent: [-1, 10] }] }] },
    { word_score_list: [{ word: 'bad', phone_score_list: [{ phone: 's', extent: [10, 3001] }] }] },
    { word_score_list: [{ word: 'bad', phone_score_list: [{ phone: 's', extent: [10] }] }] },
    { word_score_list: [{ word: 'bad', phone_score_list: [{ phone: '' }] }] },
  ])('拒绝无效上游分数、缺少句子分数或不合法的时间范围 %#', async overrides => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody(overrides)));
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).rejects.toMatchObject({
      code: 'PRONUNCIATION_INVALID_RESULT', statusCode: 502, retryable: true,
    });
  });

  it('校验最终词时间，拒绝首末音素时间倒置', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(successBody({
      word_score_list: [{ word: 'bad', phone_score_list: [
        { phone: 'b', extent: [20, 30] }, { phone: 'd', extent: [5, 10] },
      ] }],
    })));
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).rejects.toMatchObject({
      code: 'PRONUNCIATION_INVALID_RESULT',
    });
  });

  it.each(['error_no_speech', 'error_word_alignment'])('将 %s 映射成重新录音提示', async shortMessage => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      status: 'error', short_message: shortMessage, detail_message: `私密字幕 ${apiKey}`,
    }, 422));
    const error = await capture(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input));
    expect(error).toMatchObject({ code: 'PRONUNCIATION_NO_SPEECH', statusCode: 422, retryable: false });
    expect(error.message).toContain('重新朗读');
    expect(`${error.message}${error.stack}`).not.toContain(apiKey);
    expect(error.message).not.toContain('私密字幕');
  });

  it.each(['error_audio_too_long', 'error_file_too_large', 'error_audio_missing', 'error_convert_audio'])(
    '将 %s 映射为稳定的录音错误', async shortMessage => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'error', short_message: shortMessage }, 400));
      await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).rejects.toMatchObject({
        code: 'PRONUNCIATION_AUDIO_INVALID', retryable: false,
      });
    });

  it.each([
    [401, 'PRONUNCIATION_NOT_CONFIGURED', false],
    [403, 'PRONUNCIATION_NOT_CONFIGURED', false],
    [429, 'PRONUNCIATION_LIMIT_REACHED', true],
    [500, 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', true],
    [503, 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', true],
    [408, 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', true],
    [400, 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', false],
  ])('处理 HTTP %s 非 JSON 错误并屏蔽密钥与上游内容', async (status, code, retryable) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(`https://upstream.invalid/?key=${apiKey} 私密字幕`, { status }));
    const error = await capture(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input));
    expect(error).toMatchObject({ code, retryable });
    expect(error.cause).toBeUndefined();
    expect(`${error.message}${error.stack}`).not.toContain(apiKey);
    expect(error.message).not.toMatch(/upstream\.invalid|私密字幕/u);
  });

  it.each([
    ['error_key_expired', 'PRONUNCIATION_NOT_CONFIGURED', false],
    ['error_feature_unavailable', 'PRONUNCIATION_NOT_CONFIGURED', false],
    ['error_too_many_requests', 'PRONUNCIATION_LIMIT_REACHED', true],
    ['error_internal', 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', true],
    ['unknown', 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', false],
  ])('处理 HTTP 成功响应中的 %s 错误', async (shortMessage, code, retryable) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'error', short_message: shortMessage,
      detail_message: apiKey }));
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).rejects.toMatchObject({ code, retryable });
  });

  it('成功 HTTP 返回非 JSON 时拒绝评分', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('not json'));
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).rejects.toMatchObject({
      code: 'PRONUNCIATION_INVALID_RESULT',
    });
  });

  it('网络错误包含密钥、录音与字幕时只返回静态中文错误', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error(`https://upstream.invalid/?key=${apiKey} ${input.referenceText} audio=private`));
    const error = await capture(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input));
    expect(error).toMatchObject({ code: 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', retryable: true });
    expect(error.cause).toBeUndefined();
    expect(`${error.message}${error.stack}`).not.toContain(apiKey);
    expect(error.message).not.toContain(input.referenceText);
    expect(error.message).not.toContain('private');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['fetch', 'response'])('限制整个请求时长，即使 %s 忽略中止信号', async stage => {
    vi.useFakeTimers();
    const response = stage === 'response'
      ? new Response(new ReadableStream<Uint8Array>()) : jsonResponse(successBody());
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() =>
      stage === 'fetch' ? new Promise(() => {}) : Promise.resolve(response));
    const operation = capture(new SpeechaceProvider({ apiKey, timeoutMs: 20, fetch: fetchImpl }).assess(input));
    const signal = fetchImpl.mock.calls[0]![1]?.signal;
    await vi.advanceTimersByTimeAsync(20);
    expect(await operation).toMatchObject({ code: 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', retryable: true });
    expect(signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('从分块流解析 JSON，正确处理分块之间的 UTF-8 字符', async () => {
    const body = JSON.stringify(successBody({ metadata: '中文' }));
    const bytes = new TextEncoder().encode(body);
    const splitAt = new TextEncoder().encode(body.slice(0, body.indexOf('中'))).byteLength + 1;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, splitAt));
      controller.enqueue(bytes.slice(splitAt));
      controller.close();
    } });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).resolves.toMatchObject({ score: 88.25 });
  });

  it('响应恰好 1 MiB 时允许解析', async () => {
    const body = JSON.stringify(successBody());
    const padding = 1024 ** 2 - new TextEncoder().encode(body).byteLength;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body + ' '.repeat(padding)));
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).resolves.toMatchObject({ score: 88.25 });
  });

  it('响应头超限时立即取消读取', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
      headers: { 'content-length': String(1024 ** 2 + 1) },
    }));
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).rejects.toMatchObject({
      code: 'PRONUNCIATION_INVALID_RESULT', retryable: true,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('无 Content-Length 的响应流超限时取消后续读取', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(1024 ** 2));
      controller.enqueue(new Uint8Array([1]));
    }, cancel });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input)).rejects.toMatchObject({
      code: 'PRONUNCIATION_INVALID_RESULT', retryable: true,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('响应流中断时不暴露流错误里的密钥', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.error(new Error(`private body ${apiKey}`));
    } });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
    const error = await capture(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess(input));
    expect(error).toMatchObject({ code: 'PRONUNCIATION_INVALID_RESULT', retryable: true });
    expect(`${error.message}${error.stack}`).not.toContain(apiKey);
  });

  it.each([
    { audio: new Uint8Array() },
    { audio: new Uint8Array(SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES + 1) },
    { contentType: 'video/mp4' },
    { contentType: 'constructor' },
    { referenceText: '' },
    { referenceText: '只有中文' },
  ])('本地拒绝不合法评测输入，不调用付费上游 %#', async overrides => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new SpeechaceProvider({ apiKey, fetch: fetchImpl }).assess({ ...input, ...overrides })).rejects.toMatchObject({
      code: 'PRONUNCIATION_AUDIO_INVALID', retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('拒绝空密钥、非官方区域和无效超时配置', () => {
    expect(() => new SpeechaceProvider({ apiKey: ' ' })).toThrow(expect.objectContaining({ code: 'PRONUNCIATION_NOT_CONFIGURED' }));
    expect(() => new SpeechaceProvider({ apiKey, region: 'https://invalid.example' as SpeechaceRegion }))
      .toThrow(expect.objectContaining({ code: 'PRONUNCIATION_NOT_CONFIGURED' }));
    expect(() => new SpeechaceProvider({ apiKey, timeoutMs: 0 })).toThrow(expect.objectContaining({ code: 'PRONUNCIATION_NOT_CONFIGURED' }));
  });
});

function successBody(overrides: Record<string, unknown> = {}) {
  return {
    status: 'success', text_score: {
      text: input.referenceText, speechace_score: { pronunciation: 88.25 },
      word_score_list: [{ word: 'thing', quality_score: 61.5, phone_score_list: [
        { phone: 'th', quality_score: 35, extent: [25, 35], word_extent: [0, 2], sound_most_like: 's' },
        { phone: 'ih', quality_score: 87, extent: [35, 41], stress_score: 65, stress_level: 1, sound_most_like: 'ih' },
        { phone: 'ng', quality_score: 95, extent: [41, 60] },
      ] }],
      ...overrides,
    },
    version: '9.17', request_id: 'unused-private-request-id',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function capture(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('测试预期请求失败');
}
