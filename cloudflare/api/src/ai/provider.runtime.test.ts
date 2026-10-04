import { resolve } from 'node:path';

import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const apiKey = 'fake-runtime-test-key';
const draft = {
  title: 'A public satellite programme',
  paragraphs: [
    { key: 'p1', text: 'The government planned a satellite in orbit.' },
    { key: 'p2', text: 'Citizens discussed the public investment.' },
    { key: 'p3', text: 'The committee approved the programme.' },
  ],
  usages: [{ targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'orbit' }],
  questions: [{
    targetAlias: 't1', prompt: 'The satellite would enter ____.',
    optionsEn: ['orbit', 'water', 'light', 'time'], correctOptionIndex: 0,
    meaningEn: 'a path around a celestial body', explanationZh: '此处指轨道。',
    optionExplanationsZh: ['轨道符合语境。', '水不符合语境。', '光不符合语境。', '时间不符合语境。'],
    optionExplanationsEn: ['Orbit fits the context.', 'Water does not fit.', 'Light does not fit.', 'Time does not fit.'],
  }],
};
const instances: Miniflare[] = [];
let script: string;

beforeAll(async () => {
  const bundled = await build({
    stdin: {
      sourcefile: 'evolink-runtime-test.ts',
      resolveDir: resolve('.'),
      contents: `
        import { evolinkProvider } from './cloudflare/api/src/ai/provider.ts';
        export default {
          async fetch() {
            try {
              const provider = evolinkProvider({
                EVOLINK_API_KEY: '${apiKey}',
                EVOLINK_BASE_URL: 'https://upstream.invalid/v1',
                EVOLINK_TEXT_MODEL: 'test-text-model',
              });
              const input = {
                examPath: 'ielts', topic: '政治',
                targets: [{ alias: 't1', term: 'orbit', meaningZh: '轨道' }],
              };
              const signal = new AbortController().signal;
              const generated = await provider.generatePractice(input, signal);
              return Response.json({ generated });
            } catch (error) {
              return Response.json({ code: error.code, message: error.message, retryable: error.retryable },
                { status: error.statusCode ?? 500 });
            }
          }
        };
      `,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  script = bundled.outputFiles[0]!.text;
});

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

describe('Cloudflare 原生 fetch 的 AI 请求', () => {
  it('通过真实 provider 发出生成请求，不替换运行时的 fetch', async () => {
    const requests: Array<{ url: string; method: string; authorization: string | null; body: Record<string, unknown> }> = [];
    const instance = new Miniflare(convertV4MiniflareOptions({
      modules: true, script,
      compatibilityDate: '2026-09-24', compatibilityFlags: ['nodejs_compat'],
      // 只替换外部服务响应；Worker 内仍调用原生 fetch，可捕获错误的 this 绑定。
      outboundService: async (request) => {
        requests.push({
          url: request.url, method: request.method,
          authorization: request.headers.get('authorization'),
          body: await request.json() as Record<string, unknown>,
        });
        return Response.json({
          model: 'test-text-model', choices: [{ message: { content: JSON.stringify(draft) } }],
        });
      },
    }));
    instances.push(instance);
    const response = await instance.dispatchFetch('https://worker.invalid');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ generated: draft });
    // One native network request: there is no separate review call any more.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://upstream.invalid/v1/chat/completions', method: 'POST',
      authorization: `Bearer ${apiKey}`,
      body: { model: 'test-text-model', stream: false, response_format: { type: 'json_object' } },
    });
  }, 30_000);

  it('上游限流仍返回可重试的错误，响应不泄漏密钥或上游消息', async () => {
    let upstreamCalls = 0;
    const instance = new Miniflare(convertV4MiniflareOptions({
      modules: true, script,
      compatibilityDate: '2026-09-24', compatibilityFlags: ['nodejs_compat'],
      outboundService: async () => {
        upstreamCalls += 1;
        return Response.json({ error: { message: apiKey } }, { status: 429 });
      },
    }));
    instances.push(instance);
    const response = await instance.dispatchFetch('https://worker.invalid');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'AI_UNAVAILABLE', message: 'AI 服务暂时不可用', retryable: true });
    expect(upstreamCalls).toBe(1);
  }, 30_000);
});
