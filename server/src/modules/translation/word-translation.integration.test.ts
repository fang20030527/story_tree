import { describe, expect, it, vi } from 'vitest';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { registerAnonymous } from '../auth/service';
import { createVocabularyItemForUser } from '../vocabulary/service';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
});

describe('contextual word cards', () => {
  it('returns IPA and abbreviations while preserving the original, owner-scoped saved sentence', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = 'ad'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const otherToken = 'ae'.repeat(32);
      await registerAnonymous(db, otherToken, true);
      const original = 'A resilient community rebuilt the town.';
      const saved = await createVocabularyItemForUser(db, {
        userId: owner.userId,
        item: { term: 'resilient', meaningZh: '有韧性的', sourceSentence: original },
        idempotencyKey: 'original-word-00001',
      });
      const repeated = await createVocabularyItemForUser(db, {
        userId: owner.userId,
        item: { term: 'Resilient', meaningZh: '有韧性的', sourceSentence: 'A later resilient reader appeared.' },
        idempotencyKey: 'repeated-word-00001',
      });
      expect(repeated.id).toBe(saved.id);
      expect(repeated.sourceSentence).toBe(original);
      const provider = new FakeAiProvider();
      const lookupWord = vi.spyOn(provider, 'lookupWord').mockResolvedValue({
        partOfSpeech: '形容词', meaningZh: '有韧性的',
        phoneticUk: '/rɪˈzɪliənt/', phoneticUs: '/rɪˈzɪliənt/',
      });
      const app = buildApp({ config, db, logger: false, wordTranslationProvider: provider });
      try {
        const lookup = (authToken: string) => app.inject({
          method: 'POST', url: '/v1/word-translations',
          headers: { authorization: `Bearer ${authToken}` },
          payload: { term: 'Resilient', context: 'A new resilient reader appeared.' },
        });
        const response = await lookup(token);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          term: 'Resilient', partOfSpeech: 'adj.', meaningZh: '有韧性的',
          phoneticUk: '/rɪˈzɪliənt/', phoneticUs: '/rɪˈzɪliənt/',
          savedSourceSentence: original,
        });
        expect((await lookup(otherToken)).json().savedSourceSentence).toBeNull();
        lookupWord.mockResolvedValue({ partOfSpeech: 'adjective', meaningZh: '有韧性的' });
        expect((await lookup(token)).json()).toMatchObject({ partOfSpeech: 'adj.', savedSourceSentence: original });
        lookupWord.mockResolvedValueOnce({ partOfSpeech: '名词；动词', meaningZh: '适应' });
        expect((await lookup(token)).json().partOfSpeech).toBe('n. / v.');
      } finally {
        await app.close();
      }
    });
  }, 120_000);
});
