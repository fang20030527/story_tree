import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';

import { replayReviews } from '../../../../server/src/modules/vocabulary/scheduler';
import { submitAnswerOnD1, type AnswerSubmission } from './answer-write';

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  word: '22222222-2222-4222-8222-222222222222',
  item: '33333333-3333-4333-8333-333333333333',
  practice: '44444444-4444-4444-8444-444444444444',
  target: '55555555-5555-4555-8555-555555555555',
  question: '66666666-6666-4666-8666-666666666666',
  correct: '77777777-7777-4777-8777-777777777777',
  wrong: '88888888-8888-4888-8888-888888888888',
};
const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

async function setup(withHint = false) {
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
  const created = new Date(Date.now() - 86_400_000).toISOString();
  await db.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
    .bind(ids.user, 'guest', created).run();
  await db.prepare(`
    INSERT INTO vocabulary_words (id, user_id, normalized_term, review_state, created_at)
    VALUES (?, ?, 'orbit', ?, ?)
  `).bind(ids.word, ids.user, JSON.stringify(replayReviews([], new Date(created))), created).run();
  await db.prepare(`
    INSERT INTO vocabulary_items
      (id, user_id, term, word_id, normalized_term, meaning_zh,
       normalized_meaning_zh, fingerprint)
    VALUES (?, ?, 'orbit', ?, 'orbit', '轨道', '轨道', 'orbit:轨道')
  `).bind(ids.item, ids.user, ids.word).run();
  await db.prepare(`
    INSERT INTO practice_sessions (id, user_id, status, ready_at)
    VALUES (?, ?, 'ready', ?)
  `).bind(ids.practice, ids.user, created).run();
  await db.prepare(`
    INSERT INTO practice_targets (id, practice_session_id, vocabulary_item_id, position)
    VALUES (?, ?, ?, 0)
  `).bind(ids.target, ids.practice, ids.item).run();
  await db.prepare(`
    INSERT INTO practice_questions
      (id, practice_target_id, prompt, options_json, correct_option_id,
       meaning_en, explanation_zh, option_explanations_json)
    VALUES (?, ?, 'What does orbit mean?', ?, ?, 'path around a planet',
      '轨道解释', ?)
  `).bind(ids.question, ids.target, JSON.stringify([
    { id: ids.correct, text: 'path around a planet' },
    { id: ids.wrong, text: 'a kind of food' },
  ]), ids.correct, JSON.stringify({
    [ids.correct]: '正确', [ids.wrong]: '错误',
  })).run();
  if (withHint) {
    await db.prepare(`
      INSERT INTO assistance_events
        (id, practice_session_id, user_id, kind, practice_target_id,
         idempotency_key, shown_at)
      VALUES (?, ?, ?, 'word_hint', ?, 'hint-key', ?)
    `).bind(crypto.randomUUID(), ids.practice, ids.user, ids.target, created).run();
  }
  return db;
}

function submission(key = '0123456789abcdef'): AnswerSubmission {
  return {
    userId: ids.user, practiceId: ids.practice, idempotencyKey: key,
    requestHash: 'a'.repeat(64),
    request: {
      answerKind: 'option', questionId: ids.question,
      selectedOptionId: ids.correct, elapsedMs: 1000,
    },
  };
}

describe('D1 first answer and FSRS projection', () => {
  it('commits one answer, shared word state and completed practice atomically', async () => {
    const db = await setup();
    const first = await submitAnswerOnD1(db, submission());
    const replay = await submitAnswerOnD1(db, submission());
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ answerKind: 'option', isCorrect: true, wasAssisted: false });
    const practice = await db.prepare('SELECT status FROM practice_sessions WHERE id = ?')
      .bind(ids.practice).first<{ status: string }>();
    const word = await db.prepare('SELECT review_state AS state FROM vocabulary_words WHERE id = ?')
      .bind(ids.word).first<{ state: string }>();
    const events = await db.prepare('SELECT count(*) AS count FROM word_review_events WHERE word_id = ?')
      .bind(ids.word).first<{ count: number }>();
    const progress = await db.prepare('SELECT practice_count AS count FROM learning_progress WHERE vocabulary_item_id = ?')
      .bind(ids.item).first<{ count: number }>();
    expect(practice?.status).toBe('completed');
    expect(JSON.parse(word!.state)).toMatchObject({ answerCount: 1, lastOutcome: 'independent' });
    expect(events?.count).toBe(1);
    expect(progress?.count).toBe(1);
  }, 15_000);

  it('grades a prior word hint as failed even when the option was correct', async () => {
    const db = await setup(true);
    const result = await submitAnswerOnD1(db, submission());
    expect(result.wasAssisted).toBe(true);
    const word = await db.prepare('SELECT review_state AS state FROM vocabulary_words WHERE id = ?')
      .bind(ids.word).first<{ state: string }>();
    expect(JSON.parse(word!.state)).toMatchObject({ answerCount: 1, lastOutcome: 'failed' });
  }, 15_000);

  it('preserves the first answer under concurrent keys', async () => {
    const db = await setup();
    const [left, right] = await Promise.all([
      submitAnswerOnD1(db, submission('first-answer-key-1')),
      submitAnswerOnD1(db, submission('first-answer-key-2')),
    ]);
    expect(left).toEqual(right);
    const answers = await db.prepare('SELECT count(*) AS count FROM answer_attempts')
      .first<{ count: number }>();
    const word = await db.prepare('SELECT review_state AS state FROM vocabulary_words WHERE id = ?')
      .bind(ids.word).first<{ state: string }>();
    expect(answers?.count).toBe(1);
    expect(JSON.parse(word!.state).answerCount).toBe(1);
  }, 15_000);
});
