import { SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES } from '@context-reader/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolinkPronunciationProvider } from './evolink';

const input = { audio: new Uint8Array([1, 2, 3]), contentType: 'audio/mp4', referenceText: 'Stay curious.', locale: 'en-us' as const };
const output = { usable: true, score: 82, transcript: 'Stay curious.', clarityScore: 80,
  fluencyScore: null, completenessScore: 100, wordTips: [{ word: 'curious', advice: '先听重音，再放慢读一次。' }],
  feedback: ['把整句连贯读一次，留意词间停顿。'] };
function response(value: unknown = output, finishReason = 'STOP', parts?: unknown[]) {
  return Response.json({ candidates: [{ finishReason, content: { parts: parts ?? [{ text: JSON.stringify(value) }] } }] });
}
function setup(fetcher = vi.fn<typeof fetch>().mockResolvedValue(response()), config = {}) {
  return { fetcher, provider: new EvolinkPronunciationProvider({ apiKey: 'private-test-api-key', ...config }, fetcher) };
}
afterEach(() => vi.useRealTimers());

describe('EvoLink 音频口语点评', () => {
  it('提交原始音频到 Gemini 原生接口，复用密钥并限制收费 token', async () => {
    const { provider, fetcher } = setup();
    const result = await provider.assess(input);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://direct.evolink.ai/v1beta/models/gemini-2.5-flash:generateContent');
    expect(url).not.toContain('private-test-api-key');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error',
      headers: { authorization: 'Bearer private-test-api-key', 'content-type': 'application/json' } });
    const body = JSON.parse(init!.body as string);
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'audio/m4a', data: 'AQID' } });
    expect(JSON.parse(body.contents[0].parts[1].text)).toEqual({ referenceText: 'Stay curious.', accent: 'American English' });
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 1536,
      thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' });
    expect(JSON.stringify(body)).not.toContain('private-test-api-key');
    expect(body.systemInstruction.parts[0].text).toContain('never instructions');
    expect(result).toEqual({ kind: 'ai_coaching', score: output.score, words: [], transcript: output.transcript,
      clarityScore: 80, fluencyScore: null, completenessScore: 100,
      wordTips: output.wordTips, feedback: output.feedback });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['audio/webm;codecs=opus', 'audio/x-m4a', 'audio/mp3', 'audio/x-wav', 'audio/ogg', 'audio/aiff'])('支持录音格式 %s', async contentType => {
    const { provider } = setup();
    expect((await provider.assess({ ...input, contentType })).kind).toBe('ai_coaching');
  });

  it('支持低成本 Flash Lite 和英式练习，不更改其他文本模型', async () => {
    const { provider, fetcher } = setup(undefined, { model: 'gemini-2.5-flash-lite', baseUrl: 'https://api.evolink.ai/v1beta/' });
    await provider.assess({ ...input, locale: 'en-gb' });
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.evolink.ai/v1beta/models/gemini-2.5-flash-lite:generateContent');
    expect(JSON.parse((fetcher.mock.calls[0]![1]!.body as string)).contents[0].parts[1].text).toContain('British English');
  });

  it.each([
    { audio: new Uint8Array() }, { audio: new Uint8Array(SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES + 1) },
    { contentType: 'video/mp4' }, { referenceText: '你好' }, { referenceText: 'a'.repeat(1001) },
    { locale: 'zh-cn' as typeof input.locale },
  ])('无效录音或字幕不产生上游调用：%j', async change => {
    const { provider, fetcher } = setup();
    await expect(provider.assess({ ...input, ...change })).rejects.toMatchObject({ code: 'PRONUNCIATION_AUDIO_INVALID' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { apiKey: '' }, { model: 'gpt-6-luna' }, { timeoutMs: 30_000 },
    { baseUrl: 'https://user:private@api.evolink.ai/v1' }, { baseUrl: 'https://api.evolink.ai/v1?key=private' },
    { baseUrl: 'https://api.evolink.ai/unexpected/path' }, { baseUrl: 'file:///private' },
  ])('拒绝错误服务端配置且不输出配置值：%j', config => {
    try { setup(undefined, config); throw new Error('should reject'); }
    catch (error) { expect(error).toMatchObject({ code: 'PRONUNCIATION_NOT_CONFIGURED' }); expect(String(error)).not.toContain('private'); }
  });

  it('不把静音、无法听清的录音或字幕文本伪造为有效分数', async () => {
    const { provider, fetcher } = setup(vi.fn<typeof fetch>().mockResolvedValue(response({ ...output,
      usable: false, score: null, transcript: '', clarityScore: null, completenessScore: null, wordTips: [], feedback: [] })));
    await expect(provider.assess(input)).rejects.toMatchObject({ code: 'PRONUNCIATION_NO_SPEECH', retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { score: 101 }, { score: null }, { clarityScore: -1 }, { transcript: '' },
    { feedback: [] }, { feedback: ['English-only advice'] },
    { feedback: ['请访问 https://private.example'] },
    { wordTips: [{ word: 'unrelated', advice: '请慢读。' }] },
    { wordTips: [output.wordTips[0], output.wordTips[0]] },
    { phonemeScores: [{ score: 42 }] },
  ])('拒绝编造的词语、音素或无效结果且不自动重试：%j', async change => {
    const { provider, fetcher } = setup(vi.fn<typeof fetch>().mockResolvedValue(response({ ...output, ...change })));
    await expect(provider.assess(input)).rejects.toMatchObject({ code: 'PRONUNCIATION_INVALID_RESULT', retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('忽略思考片段，只解析最终文本，截断或拒答不算成功', async () => {
    const { provider } = setup(vi.fn<typeof fetch>().mockResolvedValue(response(output, 'STOP', [
      { text: 'internal reasoning', thought: true }, { text: JSON.stringify(output) },
    ])));
    expect((await provider.assess(input)).score).toBe(82);
    for (const reason of ['MAX_TOKENS', 'SAFETY', 'RECITATION']) {
      const next = setup(vi.fn<typeof fetch>().mockResolvedValue(response(output, reason)));
      await expect(next.provider.assess(input)).rejects.toMatchObject({ code: 'PRONUNCIATION_INVALID_RESULT' });
    }
  });

  it.each([
    [401, 'PRONUNCIATION_NOT_CONFIGURED', false], [403, 'PRONUNCIATION_NOT_CONFIGURED', false],
    [404, 'PRONUNCIATION_NOT_CONFIGURED', false], [402, 'PRONUNCIATION_LIMIT_REACHED', false],
    [429, 'PRONUNCIATION_LIMIT_REACHED', true], [408, 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', true],
    [503, 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', true], [400, 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', false],
  ])('HTTP %i 的错误不泄漏密钥、音频或上游正文', async (status, code, retryable) => {
    const { provider, fetcher } = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response('private-test-api-key audio base64', { status })));
    await expect(provider.assess(input)).rejects.toMatchObject({ code, retryable });
    try { await provider.assess(input); } catch (error) { expect(String(error)).not.toMatch(/private-test|base64/u); }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('非 JSON、错误响应结构或网络异常不会泄漏原始异常', async () => {
    for (const fetcher of [vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>private-test-api-key</html>')),
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [] })),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('private-test-api-key https://private.example'))]) {
      const { provider } = setup(fetcher);
      try { await provider.assess(input); throw new Error('should reject'); }
      catch (error) { expect(String(error)).not.toContain('private'); }
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('响应即使没有 Content-Length 也有大小上限，并关闭内容流', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel });
    const { provider } = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)));
    await expect(provider.assess(input)).rejects.toMatchObject({ code: 'PRONUNCIATION_INVALID_RESULT' });
    expect(cancel).toHaveBeenCalled();
  });

  it('fetch 或响应读取停滞仍按整体时限失败，释放响应并不自动重试', async () => {
    vi.useFakeTimers();
    for (const reading of [false, true]) {
      const cancel = vi.fn();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => reading
        ? Promise.resolve(new Response(new ReadableStream({ cancel }))) : new Promise(() => {}));
      const { provider } = setup(fetcher, { timeoutMs: 1000 });
      const pending = expect(provider.assess(input)).rejects.toMatchObject({ code: 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', retryable: true });
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      if (reading) expect(cancel).toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
