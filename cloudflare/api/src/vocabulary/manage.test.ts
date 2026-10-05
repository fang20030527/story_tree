import {
  RenamedVocabularyWordSchema,
  VocabularyContextSchema,
  VocabularyTermsSchema,
  VocabularyWordContextsSchema,
  VocabularyWordPageSchema,
} from '@context-reader/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApiEnv } from '../env';
import { createMiniflareD1, disposeMiniflareD1 } from '../test-support/miniflare-d1';
import { handleVocabularyCreateRoute } from './create';
import { handleVocabularyReadRoute } from './items';
import { handleVocabularyManageRoute } from './manage';
import { handleVocabularyWordRoute } from './words';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const base = 'https://blackholeenglish.com';
let keys = 0;

afterEach(disposeMiniflareD1);

async function setup() {
  const db = await createMiniflareD1('vocabulary-manage-test');
  for (const id of [userId, otherUserId]) {
    await db.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
      .bind(id, 'registered', new Date().toISOString()).run();
  }
  return { db, env: { DB: db } as unknown as ApiEnv };
}

const nextKey = () => `vocabulary_manage_key_${String(++keys).padStart(6, '0')}`;

async function save(env: ApiEnv, term: string, meaningZh: string, owner = userId) {
  const response = await handleVocabularyCreateRoute(new Request(`${base}/v1/vocabulary-items`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': nextKey() },
    body: JSON.stringify({ term, meaningZh }),
  }), env, owner);
  expect(response!.status).toBe(201);
}

async function words(env: ApiEnv, owner = userId) {
  const response = await handleVocabularyWordRoute(new Request(`${base}/v1/vocabulary-words?filter=all&limit=50`), env, owner);
  return VocabularyWordPageSchema.parse(await response!.json());
}

async function contexts(env: ApiEnv, wordId: string) {
  const response = await handleVocabularyReadRoute(new Request(`${base}/v1/vocabulary-words/${wordId}/contexts`), env, userId);
  return VocabularyWordContextsSchema.parse(await response!.json()).contexts;
}

function call(env: ApiEnv, method: 'DELETE' | 'PATCH', path: string, body?: unknown, key?: string, owner = userId) {
  return handleVocabularyManageRoute(new Request(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, owner);
}

describe('生词删除与修改', () => {
  it('删除单词后从词库和高亮里消失，重新保存时回到在学而不是已掌握', async () => {
    const { db, env } = await setup();
    await save(env, 'orbit', '轨道');
    await save(env, 'orbit', '环绕');
    await save(env, 'signal', '信号');
    const orbit = (await words(env)).items.find((item) => item.term === 'orbit')!;
    await db.prepare('UPDATE vocabulary_words SET mastered_at = ? WHERE id = ?').bind(new Date().toISOString(), orbit.wordId).run();

    expect((await call(env, 'DELETE', `/v1/vocabulary-words/${orbit.wordId}`))!.status).toBe(204);
    expect((await call(env, 'DELETE', `/v1/vocabulary-words/${orbit.wordId}`))!.status).toBe(204);
    expect((await words(env)).items.map((item) => item.term)).toEqual(['signal']);
    const terms = await handleVocabularyReadRoute(new Request(`${base}/v1/vocabulary-terms`), env, userId);
    expect(VocabularyTermsSchema.parse(await terms!.json()).terms).toEqual(['signal']);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM vocabulary_items WHERE word_id = ? AND deleted_at IS NOT NULL')
      .bind(orbit.wordId).first()).toEqual({ count: 2 });

    await save(env, 'orbit', '轨道');
    const restored = (await words(env)).items.find((item) => item.term === 'orbit')!;
    expect(restored).toMatchObject({ wordId: orbit.wordId, masteredAt: null, contextCount: 1 });
  });

  it('只删除一个释义，另一个释义保留', async () => {
    const { env } = await setup();
    await save(env, 'orbit', '轨道');
    await save(env, 'orbit', '环绕');
    const orbit = (await words(env)).items[0]!;
    const [first, second] = await contexts(env, orbit.wordId);
    expect((await call(env, 'DELETE', `/v1/vocabulary-items/${first!.id}`))!.status).toBe(204);
    expect((await contexts(env, orbit.wordId)).map((context) => context.id)).toEqual([second!.id]);
  });

  it('修改释义和例句，与同一单词的其他释义重复时拒绝', async () => {
    const { env } = await setup();
    await save(env, 'orbit', '轨道');
    await save(env, 'orbit', '环绕');
    const orbit = (await words(env)).items[0]!;
    const [latest, earlier] = await contexts(env, orbit.wordId);
    const response = await call(env, 'PATCH', `/v1/vocabulary-items/${latest!.id}`,
      { meaningZh: '绕……运行', sourceSentence: 'The moon orbits the earth.' });
    expect(VocabularyContextSchema.parse(await response!.json())).toEqual({
      id: latest!.id, meaningZh: '绕……运行', sourceSentence: 'The moon orbits the earth.',
    });
    await expect(call(env, 'PATCH', `/v1/vocabulary-items/${latest!.id}`,
      { meaningZh: earlier!.meaningZh, sourceSentence: null })).rejects.toMatchObject({ code: 'VOCABULARY_DUPLICATE' });
    const cleared = await call(env, 'PATCH', `/v1/vocabulary-items/${latest!.id}`, { meaningZh: '绕……运行', sourceSentence: null });
    expect(VocabularyContextSchema.parse(await cleared!.json()).sourceSentence).toBeNull();
  });

  it('修改拼写把全部释义移到新单词，重放返回同一结果，词库仍可正常读取', async () => {
    const { env } = await setup();
    await save(env, 'recieve', '收到');
    await save(env, 'recieve', '接待');
    const wrong = (await words(env)).items[0]!;
    const key = nextKey();
    const renamed = RenamedVocabularyWordSchema.parse(await (await call(env, 'PATCH',
      `/v1/vocabulary-words/${wrong.wordId}`, { term: 'receive' }, key))!.json());
    expect(renamed.term).toBe('receive');
    expect(renamed.wordId).not.toBe(wrong.wordId);
    const replay = RenamedVocabularyWordSchema.parse(await (await call(env, 'PATCH',
      `/v1/vocabulary-words/${wrong.wordId}`, { term: 'receive' }, key))!.json());
    expect(replay).toEqual(renamed);
    await expect(call(env, 'PATCH', `/v1/vocabulary-words/${wrong.wordId}`, { term: 'recover' }, key))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const page = await words(env);
    expect(page.items.map((item) => [item.term, item.contextCount])).toEqual([['receive', 2]]);
    expect((await contexts(env, renamed.wordId)).map((context) => context.meaningZh).sort()).toEqual(['接待', '收到']);
  });

  it('改成已有的单词时合并相同释义；只改大小写时原地修改', async () => {
    const { env } = await setup();
    await save(env, 'colour', '颜色');
    await save(env, 'color', '颜色');
    await save(env, 'color', '色彩');
    const colour = (await words(env)).items.find((item) => item.term === 'colour')!;
    const color = (await words(env)).items.find((item) => item.term === 'color')!;
    const merged = RenamedVocabularyWordSchema.parse(await (await call(env, 'PATCH',
      `/v1/vocabulary-words/${colour.wordId}`, { term: 'color' }, nextKey()))!.json());
    expect(merged.wordId).toBe(color.wordId);
    expect((await contexts(env, color.wordId)).map((context) => context.meaningZh).sort()).toEqual(['色彩', '颜色']);

    const cased = RenamedVocabularyWordSchema.parse(await (await call(env, 'PATCH',
      `/v1/vocabulary-words/${color.wordId}`, { term: 'Color' }, nextKey()))!.json());
    expect(cased.wordId).toBe(color.wordId);
    expect((await words(env)).items.map((item) => item.term)).toEqual(['Color']);
  });

  it('不能修改或删除其他账号的单词', async () => {
    const { env } = await setup();
    await save(env, 'orbit', '轨道', otherUserId);
    const orbit = (await words(env, otherUserId)).items[0]!;
    await expect(call(env, 'DELETE', `/v1/vocabulary-words/${orbit.wordId}`)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(call(env, 'PATCH', `/v1/vocabulary-words/${orbit.wordId}`, { term: 'orbital' }, nextKey()))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await words(env, otherUserId)).items).toHaveLength(1);
  });
});
