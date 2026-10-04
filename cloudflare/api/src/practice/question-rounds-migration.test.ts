import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { closeTestDatabases, createTestD1, readMigration } from '../test-support/sqlite-d1';

afterEach(closeTestDatabases);

const MIGRATION = '0010_question_rounds.sql';
const beforeMigration = (name: string) => name < MIGRATION;

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  otherUser: '11111111-1111-4111-8111-222222222222',
  word: '22222222-2222-4222-8222-222222222222',
  item: '33333333-3333-4333-8333-333333333333',
  practice: '44444444-4444-4444-8444-444444444444',
  target: '55555555-5555-4555-8555-555555555555',
  otherTarget: '55555555-5555-4555-8555-666666666666',
  question: '66666666-6666-4666-8666-666666666666',
  otherQuestion: '66666666-6666-4666-8666-777777777777',
  answer: '99999999-9999-4999-8999-999999999999',
};

/** Rows as 0009 leaves them: a finished practice with one answered and one unanswered question. */
function seed(sqlite: DatabaseSync) {
  const run = (sql: string, ...values: Array<string | number | null>) => sqlite.prepare(sql).run(...values);
  run('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)', ids.user, 'guest', '2026-01-01T00:00:00.000Z');
  run('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)', ids.otherUser, 'guest', '2026-01-01T00:00:00.000Z');
  run(`INSERT INTO vocabulary_words (id, user_id, normalized_term, created_at) VALUES (?, ?, 'orbit', '2026-01-01T00:00:00.000Z')`,
    ids.word, ids.user);
  run(`INSERT INTO vocabulary_items (id, user_id, term, word_id, normalized_term, meaning_zh, normalized_meaning_zh, fingerprint)
    VALUES (?, ?, 'orbit', ?, 'orbit', '轨道', '轨道', 'orbit:轨道')`, ids.item, ids.user, ids.word);
  run(`INSERT INTO practice_sessions (id, user_id, status, ready_at) VALUES (?, ?, 'in_progress', '2026-01-01T00:00:00.000Z')`,
    ids.practice, ids.user);
  run('INSERT INTO practice_targets (id, practice_session_id, vocabulary_item_id, position) VALUES (?, ?, ?, 0)',
    ids.target, ids.practice, ids.item);
  const question = (id: string, target: string, prompt: string) => run(
    `INSERT INTO practice_questions (id, practice_target_id, prompt, options_json, correct_option_id, meaning_en, explanation_zh, option_explanations_json)
     VALUES (?, ?, ?, '[{"id":"a","label":"orbit"},{"id":"b","label":"stone"}]', 'a', 'a path around a planet', '轨道解释', '{"a":"对","b":"错"}')`,
    id, target, prompt);
  question(ids.question, ids.target, 'The moon follows an ____ around the Earth.');
  run(`INSERT INTO answer_attempts
      (id, practice_session_id, practice_question_id, user_id, answer_kind, selected_option_id, is_correct, was_assisted, elapsed_ms, idempotency_key, submitted_at)
    VALUES (?, ?, ?, ?, 'option', 'a', 1, 0, 4200, 'answer-key-0001', '2026-01-02T03:04:05.678Z')`,
    ids.answer, ids.practice, ids.question, ids.user);
  // A target of the same practice whose question is not answered yet.
  const secondItem = '33333333-3333-4333-8333-444444444444';
  run(`INSERT INTO vocabulary_items (id, user_id, term, word_id, normalized_term, meaning_zh, normalized_meaning_zh, fingerprint)
    VALUES (?, ?, 'orbit', ?, 'orbit', '眼眶', '眼眶', 'orbit:眼眶')`, secondItem, ids.user, ids.word);
  run('INSERT INTO practice_targets (id, practice_session_id, vocabulary_item_id, position) VALUES (?, ?, ?, 1)',
    ids.otherTarget, ids.practice, secondItem);
  question(ids.otherQuestion, ids.otherTarget, 'The doctor examined the ____ of the eye.');
}

const rows = (sqlite: DatabaseSync, sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;
const tables = (sqlite: DatabaseSync, like: string) => rows(sqlite, `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '${like}'`)
  .map((row) => row.name);

function database() {
  const context = createTestD1(beforeMigration);
  seed(context.sqlite);
  return context;
}

describe('0010_question_rounds.sql', () => {
  it('has to avoid dropping practice_questions first: with foreign keys on, that deletes every answer', () => {
    const { sqlite } = database();
    expect(rows(sqlite, 'SELECT count(*) AS count FROM answer_attempts')).toEqual([{ count: 1 }]);

    // The obvious rebuild: D1 cannot switch foreign keys off, so the implicit DELETE of the drop cascades.
    sqlite.exec('DROP TABLE practice_questions');

    expect(rows(sqlite, 'SELECT count(*) AS count FROM answer_attempts')).toEqual([{ count: 0 }]);
  });

  it('keeps every question and answer exactly as stored and gives the questions round 0', () => {
    const { sqlite } = database();
    const questionsBefore = rows(sqlite, 'SELECT * FROM practice_questions ORDER BY id');
    const answersBefore = rows(sqlite, 'SELECT * FROM answer_attempts ORDER BY id');
    expect(questionsBefore).toHaveLength(2);
    expect(answersBefore).toHaveLength(1);

    sqlite.exec(readMigration(MIGRATION));

    expect(rows(sqlite, 'SELECT * FROM practice_questions ORDER BY id')).toEqual(
      questionsBefore.map((question) => ({ ...question, round: 0 })),
    );
    expect(rows(sqlite, 'SELECT * FROM answer_attempts ORDER BY id')).toEqual(answersBefore);
    expect(rows(sqlite, 'PRAGMA foreign_key_check')).toEqual([]);
    expect(rows(sqlite, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });

  it('leaves no backup tables or guard rows behind', () => {
    const { sqlite } = database();
    sqlite.exec(readMigration(MIGRATION));
    expect(tables(sqlite, 'migration_0010_%')).toEqual([]);
    expect(rows(sqlite, 'SELECT * FROM transaction_guards')).toEqual([]);
  });

  it('lets a target have several questions, one per round', () => {
    const { sqlite } = database();
    sqlite.exec(readMigration(MIGRATION));
    const add = (id: string, round: number) => sqlite.prepare(
      `INSERT INTO practice_questions (id, practice_target_id, prompt, options_json, correct_option_id, meaning_en, explanation_zh, option_explanations_json, round)
       VALUES (?, ?, 'Another ____ sentence.', '[]', 'a', 'm', 'z', '{}', ?)`,
    ).run(id, ids.target, round);

    add('66666666-6666-4666-8666-000000000001', 1);
    add('66666666-6666-4666-8666-000000000002', 2);

    expect(rows(sqlite, `SELECT round FROM practice_questions WHERE practice_target_id = '${ids.target}' ORDER BY round`))
      .toEqual([{ round: 0 }, { round: 1 }, { round: 2 }]);
    // The same round of one target is still a duplicate, and a round cannot be negative.
    expect(() => add('66666666-6666-4666-8666-000000000003', 1)).toThrow(/UNIQUE/u);
    expect(() => add('66666666-6666-4666-8666-000000000004', -1)).toThrow(/CHECK/u);
    // An API from before this migration writes no round: the question counts as the first one,
    // so a second such question for the same target is rejected exactly as it was before.
    expect(() => sqlite.prepare(
      `INSERT INTO practice_questions (id, practice_target_id, prompt, options_json, correct_option_id, meaning_en, explanation_zh, option_explanations_json)
       VALUES ('66666666-6666-4666-8666-000000000005', ?, 'p', '[]', 'a', 'm', 'z', '{}')`,
    ).run(ids.target)).toThrow(/UNIQUE/u);
  });

  it('keeps the answer rules: one first answer per question, one answer per idempotency key, valid references', () => {
    const { sqlite } = database();
    sqlite.exec(readMigration(MIGRATION));
    const answer = (id: string, question: string, key: string, user = ids.user) => sqlite.prepare(
      `INSERT INTO answer_attempts (id, practice_session_id, practice_question_id, user_id, answer_kind, selected_option_id, is_correct, was_assisted, elapsed_ms, idempotency_key)
       VALUES (?, ?, ?, ?, 'option', 'a', 1, 0, 100, ?)`,
    ).run(id, ids.practice, question, user, key);

    expect(() => answer('99999999-9999-4999-8999-000000000001', ids.question, 'another-key-0002')).toThrow(/UNIQUE/u);
    expect(() => answer('99999999-9999-4999-8999-000000000002', ids.otherQuestion, 'answer-key-0001')).toThrow(/UNIQUE/u);
    expect(() => answer('99999999-9999-4999-8999-000000000003', 'no-such-question', 'another-key-0003')).toThrow(/FOREIGN KEY/u);
    answer('99999999-9999-4999-8999-000000000004', ids.otherQuestion, 'another-key-0004');
    expect(rows(sqlite, 'SELECT count(*) AS count FROM answer_attempts')).toEqual([{ count: 2 }]);
    expect(rows(sqlite, `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'answer_attempts' AND name LIKE 'answer_%' ORDER BY name`))
      .toEqual([{ name: 'answer_first_attempt_unique' }, { name: 'answer_idempotency_unique' }]);
  });

  it('keeps the cascades: deleting a practice removes its targets, questions and answers', () => {
    const { sqlite } = database();
    sqlite.exec(readMigration(MIGRATION));

    sqlite.prepare('DELETE FROM practice_sessions WHERE id = ?').run(ids.practice);

    for (const table of ['practice_targets', 'practice_questions', 'answer_attempts']) {
      expect(rows(sqlite, `SELECT count(*) AS count FROM ${table}`)).toEqual([{ count: 0 }]);
    }
  });

  it('stops before deleting the backups when the restored rows do not match them', () => {
    const { sqlite } = database();
    // A migration whose answers are not restored: the row-count check must abort it.
    const broken = readMigration(MIGRATION).replace(
      /INSERT INTO answer_attempts\s*\([^)]*\)\s*SELECT[\s\S]*?FROM migration_0010_answers;/u, '',
    );
    expect(broken).not.toBe(readMigration(MIGRATION));

    expect(() => sqlite.exec(broken)).toThrow(/CHECK/u);

    // The data is still there, in the backup tables.
    expect(rows(sqlite, 'SELECT count(*) AS count FROM migration_0010_answers')).toEqual([{ count: 1 }]);
    expect(rows(sqlite, 'SELECT count(*) AS count FROM migration_0010_questions')).toEqual([{ count: 2 }]);
    expect(rows(sqlite, 'SELECT id FROM migration_0010_answers')).toEqual([{ id: ids.answer }]);
  });
});
