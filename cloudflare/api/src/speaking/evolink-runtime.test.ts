import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('在真实 Workers 运行时提交音频并解析中文点评，使用假上游且不产生费用', async () => {
  const calls: { redirect: string; authorization: string | null; body: unknown }[] = [];
  const bundle = await build({
    stdin: {
      contents: `import { EvolinkPronunciationProvider } from './server/src/infrastructure/speech/evolink';
        export default { async fetch() {
          const provider = new EvolinkPronunciationProvider({ apiKey: 'private-runtime-test-key' });
          return Response.json(await provider.assess({ audio: new Uint8Array([1, 2, 3]),
            contentType: 'audio/mp4', referenceText: 'Stay curious.', locale: 'en-us' }));
        } };`,
      resolveDir: fileURLToPath(new URL('../../../../', import.meta.url)),
      loader: 'ts',
    },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    external: ['node:buffer'],
  });
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-09-24', compatibilityFlags: ['nodejs_compat'],
    script: bundle.outputFiles[0]!.text,
    outboundService: async request => {
      calls.push({ redirect: request.redirect, authorization: request.headers.get('authorization'), body: await request.json() });
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
        usable: true, score: 80, transcript: 'Stay curious.', clarityScore: 80,
        fluencyScore: null, completenessScore: 100, wordTips: [], feedback: ['放慢再连贯读一次。'],
      }) }] } }] });
    },
  }));
  try {
    const response = await runtime.dispatchFetch('https://runtime.example.test');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: 'ai_coaching', score: 80, words: [], feedback: ['放慢再连贯读一次。'] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ authorization: 'Bearer private-runtime-test-key', body: {
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/m4a', data: 'AQID' } }, expect.anything()] }],
    } });
  } finally { await runtime.dispose(); }
}, 30_000);
