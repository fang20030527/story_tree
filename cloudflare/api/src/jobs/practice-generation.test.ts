import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnv } from '../env';
import { handlePracticeGeneration } from './practice-generation';
import type { ClaimedJob } from './repository';

const generated = vi.hoisted(() => vi.fn());
const verified = vi.hoisted(() => vi.fn());
const validated = vi.hoisted(() => vi.fn());

vi.mock('../ai/provider', () => ({
  evolinkProvider: () => ({ generatePractice: generated, verifyPractice: verified }),
}));
vi.mock('../cpu/client', () => ({ validatePracticeOnCpuBoundary: validated }));

const userId = '11111111-1111-4111-8111-111111111111';
const wordId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const practiceId = '44444444-4444-4444-8444-444444444444';
const targetId = '55555555-5555-4555-8555-555555555555';
const jobId = '66666666-6666-4666-8666-666666666666';
const workerId = 'test-worker';
const instances: Miniflare[] = [];

afterEach(async () => {
  generated.mockReset();
  verified.mockReset();
  validated.mockReset();
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: 'test' },
  }));
  instances.push(mf);
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_initial.sql', '0002_transaction_guards.sql', '0003_import_media.sql']) {
    const sql = readFileSync(resolve('cloudflare/api/migrations', name), 'utf8')
      .split(/\r?\n/u).filter((line) => !/^\s*--/u.test(line)).join('\n');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  const now = new Date();
  const deadlineAt = new Date(now.getTime() + 300_000);
  await db.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
    .bind(userId, 'guest', now.toISOString()).run();
  await db.prepare('INSERT INTO vocabulary_words (id, user_id, normalized_term) VALUES (?, ?, ?)')
    .bind(wordId, userId, 'orbit').run();
  await db.prepare(`
    INSERT INTO vocabulary_items
      (id, user_id, term, word_id, normalized_term, meaning_zh,
       normalized_meaning_zh, fingerprint)
    VALUES (?, ?, 'orbit', ?, 'orbit', '轨道', '轨道', ?)
  `).bind(itemId, userId, wordId, 'orbit:轨道').run();
  await db.prepare('INSERT INTO practice_sessions (id, user_id) VALUES (?, ?)')
    .bind(practiceId, userId).run();
  await db.prepare(`
    INSERT INTO practice_targets (id, practice_session_id, vocabulary_item_id, position)
    VALUES (?, ?, ?, 0)
  `).bind(targetId, practiceId, itemId).run();
  await db.prepare(`
    INSERT INTO usage_ledger (id, user_id, practice_session_id, kind, amount, operation_key)
    VALUES (?, ?, ?, 'reserve', -1, ?)
  `).bind(crypto.randomUUID(), userId, practiceId, `${practiceId}:reserve`).run();
  await db.prepare(`
    INSERT INTO jobs
      (id, kind, resource_id, status, attempt_count, max_attempts,
       available_at, deadline_at, locked_at, lease_expires_at, locked_by)
    VALUES (?, 'practice_generation', ?, 'running', 1, 3, ?, ?, ?, ?, ?)
  `).bind(jobId, practiceId, now.toISOString(), deadlineAt.toISOString(),
    now.toISOString(), new Date(now.getTime() + 30_000).toISOString(), workerId).run();
  const job: ClaimedJob = {
    id: jobId, kind: 'practice_generation', resourceId: practiceId,
    attemptCount: 1, maxAttempts: 3, deadlineAt, lockedBy: workerId, expired: false,
  };
  return { db, env: { DB: db } as unknown as ApiEnv, job };
}

describe('practice generation on D1', () => {
  it('persists a validated article, answer and quota settlement in one batch', async () => {
    const { db, env, job } = await setup();
    const paragraphs = [
      { key: 'p1', text: 'The satellite moved into orbit.' },
      { key: 'p2', text: 'Scientists watched it carefully.' },
      { key: 'p3', text: 'The mission continued.' },
    ];
    generated.mockResolvedValue({ title: 'A mission', paragraphs, usages: [], questions: [] });
    verified.mockResolvedValue({ approved: true, issues: [] });
    validated.mockResolvedValue({
      title: 'A mission', wordCount: 250, paragraphs,
      usages: [{
        targetId, targetAlias: 't1', paragraphKey: 'p1', paragraphIndex: 0,
        surfaceForm: 'orbit', startOffset: 25, endOffset: 30,
      }],
      questions: [{
        targetId, targetAlias: 't1', prompt: 'The satellite entered ____.',
        optionsEn: ['orbit', 'water', 'light', 'time'], correctOptionIndex: 0,
        meaningEn: 'a path around a celestial body', explanationZh: '轨道',
        optionExplanationsZh: ['正确', '错误', '错误', '错误'],
        optionExplanationsEn: ['correct', 'incorrect', 'incorrect', 'incorrect'],
      }],
    });

    await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

    const practice = await db.prepare(`
      SELECT status, generation_progress AS progress, article_title AS title,
        article_word_count AS words FROM practice_sessions WHERE id = ?
    `).bind(practiceId).first<{ status: string; progress: number; title: string; words: number }>();
    const paragraphCount = await db.prepare('SELECT count(*) AS count FROM practice_paragraphs')
      .first<{ count: number }>();
    const questionCount = await db.prepare('SELECT count(*) AS count FROM practice_questions')
      .first<{ count: number }>();
    const target = await db.prepare('SELECT paragraph_id AS paragraphId FROM practice_targets WHERE id = ?')
      .bind(targetId).first<{ paragraphId: string | null }>();
    const settled = await db.prepare("SELECT kind FROM usage_ledger WHERE kind IN ('commit', 'release')")
      .all<{ kind: string }>();
    expect(practice).toMatchObject({ status: 'ready', progress: 100, title: 'A mission', words: 250 });
    expect(paragraphCount?.count).toBe(3);
    expect(questionCount?.count).toBe(1);
    expect(target?.paragraphId).toBeTruthy();
    expect(settled.results).toEqual([{ kind: 'commit' }]);
  }, 30_000);
});
