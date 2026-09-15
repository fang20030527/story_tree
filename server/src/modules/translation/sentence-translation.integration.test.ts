import { describe, expect, it, vi } from 'vitest';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import { registerAnonymous } from '../auth/service';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
});

describe('sentence translations', () => {
  it('requires authentication, validates input and translates only supplied text', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = 'bf'.repeat(32);
      await registerAnonymous(db, token, true);
      const translate = vi.fn().mockResolvedValue('鸟儿飞翔。');
      const app = buildApp({ config, db, logger: false, sentenceTranslationProvider: { translate } });
      try {
        const send = (text: string, authenticated = true) => app.inject({
          method: 'POST', url: '/v1/sentence-translations',
          headers: authenticated ? { authorization: `Bearer ${token}` } : {},
          payload: { text },
        });
        expect((await send('Birds fly.', false)).statusCode).toBe(401);
        expect((await send('   ')).statusCode).toBe(400);
        expect((await send('x'.repeat(10_001))).statusCode).toBe(400);
        expect(translate).not.toHaveBeenCalled();
        const response = await send('Birds fly.');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ translatedTextZh: '鸟儿飞翔。' });
        expect(translate).toHaveBeenCalledWith('Birds fly.', expect.any(AbortSignal));
        translate.mockResolvedValueOnce('');
        expect((await send('Birds fly.')).statusCode).toBe(502);
      } finally {
        await app.close();
      }
    });
  }, 120_000);
});
