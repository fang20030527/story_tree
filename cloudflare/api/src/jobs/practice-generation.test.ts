import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PracticeDtoSchema } from '@context-reader/contracts';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../server/src/core/errors';

import type { ApiEnv } from '../env';
import {
  fixtureArticle,
  fixtureFillers,
  fixtureOverlongArticle,
  fixtureSpecs,
} from '../../../../server/src/modules/practice/generation-test-fixtures';
import {
  PracticeValidationError,
  validateGeneratedPractice,
} from '../../../../server/src/modules/practice/generation-validator';
import { handlePracticeReadRoute } from '../practice/read';
import { failPracticeGeneration, handlePracticeGeneration } from './practice-generation';
import type { ClaimedJob } from './repository';

const generated = vi.hoisted(() => vi.fn());
const validated = vi.hoisted(() => vi.fn());

vi.mock('../ai/provider', () => ({
  evolinkProvider: () => ({ generatePractice: generated }),
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
  validated.mockReset();
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

async function setup(topic?: { terms: ReadonlyArray<{ term: string; meaningZh: string }>; topic: string }) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: 'test' },
  }));
  instances.push(mf);
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_initial.sql', '0002_transaction_guards.sql', '0003_import_media.sql', '0004_user_practice_access.sql', '0010_question_rounds.sql', '0011_daily_quota.sql']) {
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
  const terms = topic?.terms ?? [{ term: 'orbit', meaningZh: '轨道' }];
  await db.prepare('INSERT INTO practice_sessions (id, user_id, topic) VALUES (?, ?, ?)')
    .bind(practiceId, userId, topic?.topic ?? null).run();
  for (const [index, { term, meaningZh }] of terms.entries()) {
    const rowWordId = index === 0 ? wordId : crypto.randomUUID();
    const rowItemId = index === 0 ? itemId : crypto.randomUUID();
    await db.prepare('INSERT INTO vocabulary_words (id, user_id, normalized_term) VALUES (?, ?, ?)')
      .bind(rowWordId, userId, term).run();
    await db.prepare(`
      INSERT INTO vocabulary_items
        (id, user_id, term, word_id, normalized_term, meaning_zh,
         normalized_meaning_zh, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(rowItemId, userId, term, rowWordId, term, meaningZh, meaningZh, `${term}:${meaningZh}`).run();
    await db.prepare(`
      INSERT INTO practice_targets (id, practice_session_id, vocabulary_item_id, position)
      VALUES (?, ?, ?, ?)
    `).bind(index === 0 ? targetId : crypto.randomUUID(), practiceId, rowItemId, index).run();
  }
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

const orbitPractice = {
  title: 'A mission', wordCount: 250,
  paragraphs: [
    { key: 'p1', text: 'The satellite moved into orbit.' },
    { key: 'p2', text: 'Scientists watched it carefully.' },
    { key: 'p3', text: 'The mission continued.' },
  ],
  usages: [{
    targetId, targetAlias: 't1', paragraphKey: 'p1', paragraphIndex: 0,
    surfaceForm: 'orbit', startOffset: 25, endOffset: 30,
  }],
  questions: [{
    targetId, targetAlias: 't1', round: 0, prompt: 'The satellite entered ____.',
    optionsEn: ['orbit', 'water', 'light', 'time'], correctOptionIndex: 0,
    meaningEn: 'a path around a celestial body', explanationZh: '轨道',
    optionExplanationsZh: ['正确', '错误', '错误', '错误'],
    optionExplanationsEn: ['correct', 'incorrect', 'incorrect', 'incorrect'],
  }],
};

describe('practice generation on D1', () => {
  it('rewrites an unusable draft once, with the problem named, and stores the second draft', async () => {
    const { db, env, job } = await setup();
    const draft = { title: 'A mission', paragraphs: orbitPractice.paragraphs, usages: [], questions: [] };
    const issue = 'These targets do not appear in the article: t1 ("orbit").';
    generated.mockResolvedValue(draft);
    validated.mockRejectedValueOnce(new PracticeValidationError(issue, ['TARGET_MISSING']))
      .mockResolvedValueOnce(orbitPractice);
    await handlePracticeGeneration(env, job, { signal: new AbortController().signal });
    expect(generated).toHaveBeenCalledTimes(2);
    expect(generated.mock.calls[1]?.[0].revision).toEqual({ generated: draft, issues: [issue] });
    // Only the last draft may be completed instead of rejected.
    expect(validated.mock.calls.map((call) => call[4])).toEqual([{ completeMissing: false }, { completeMissing: false }]);
    expect(await db.prepare('SELECT status FROM practice_sessions WHERE id = ?')
      .bind(practiceId).first()).toEqual({ status: 'ready' });
  }, 30_000);

  it('persists a validated article, answer and quota settlement in one batch', async () => {
    const { db, env, job } = await setup();
    generated.mockResolvedValue({ title: 'A mission', paragraphs: orbitPractice.paragraphs, usages: [], questions: [] });
    validated.mockResolvedValue(orbitPractice);

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

describe('topic essays through the real validator on D1', () => {
  const topic = { topic: '环境', terms: fixtureSpecs.map(({ term, meaningZh }) => ({ term, meaningZh })) };
  const lines: string[] = [];
  type Database = Awaited<ReturnType<typeof setup>>['db'];

  function useRealValidator() {
    validated.mockImplementation(async (_env, generate, targets, length, options) =>
      validateGeneratedPractice(generate, targets, length, options));
    vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line); });
  }

  afterEach(() => { vi.restoreAllMocks(); lines.length = 0; });

  const events = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  const readyRows = (db: Database) => db.prepare(`
    SELECT p.status, p.generation_progress AS progress, p.article_word_count AS words, p.prompt_version AS version,
      (SELECT count(*) FROM practice_paragraphs WHERE practice_session_id = p.id) AS paragraphs,
      (SELECT count(*) FROM practice_questions) AS questions,
      (SELECT count(*) FROM practice_questions AS q
        WHERE json_array_length(q.options_json) = 4
          AND EXISTS (SELECT 1 FROM json_each(q.options_json) WHERE json_extract(value, '$.id') = q.correct_option_id)
          AND (SELECT count(*) FROM json_each(q.option_explanations_json)) = 4) AS wellFormed,
      (SELECT count(*) FROM practice_targets AS t JOIN practice_paragraphs AS g ON g.id = t.paragraph_id
        WHERE t.practice_session_id = p.id AND t.surface_form IS NOT NULL
          AND substr(g.plain_text, t.start_offset + 1, t.end_offset - t.start_offset) = t.surface_form) AS located
    FROM practice_sessions AS p WHERE p.id = ?
  `).bind(practiceId).first<Record<string, unknown>>();

  /** The real read route, so a stored practice is checked against the client's strict contract. */
  async function readThroughApi(env: ApiEnvLike) {
    const response = await handlePracticeReadRoute(new Request(`https://api.test/v1/practices/${practiceId}`), env, userId);
    expect(response?.status).toBe(200);
    return PracticeDtoSchema.parse(await response!.json());
  }
  type ApiEnvLike = Parameters<typeof handlePracticeReadRoute>[1];

  it('stores a messy draft after repairing it, with no rewrite, and the client can read it', async () => {
    useRealValidator();
    const { db, env, job } = await setup(topic);
    const messy = fixtureArticle();
    messy.questions[0]!.prompt = 'Planting trees along the coast can ________ the damage caused by storms.';
    messy.questions[1]!.explanationZh = 'This word is correct for the sentence in every situation.';
    messy.questions[2]!.optionsEn = ['object', 'object', 'advocate'];
    messy.questions[2]!.correctOptionIndex = 7;
    messy.questions[3]!.optionExplanationsZh = [];
    messy.questions[4]!.optionsEn = ['accident', 'initiative', 'argument', 'delay', 'plan', 'idea'];
    messy.questions.splice(5, 1);
    generated.mockResolvedValue(messy);

    await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

    expect(generated).toHaveBeenCalledTimes(1);
    expect(await readyRows(db)).toMatchObject({
      status: 'ready', progress: 100, words: 218, version: 'ielts-topic-short-english-cloze-v5',
      paragraphs: 3, questions: 6, wellFormed: 6, located: 6,
    });
    const practice = await readThroughApi(env);
    expect(practice.status).toBe('ready');
    expect(practice.questions).toHaveLength(6);
    const logged = events();
    expect(logged.map((event) => event.stage)).toEqual(['start', 'generate', 'validate', 'done', 'persisted']);
    expect(logged[2]).toMatchObject({ outcome: 'ok', notes: ['OPTIONS_PADDED:t3', 'OPTIONS_TRIMMED:t5', 'QUESTION_BUILT:t6'] });
    expect(logged.every((event) => event.event === 'practice_generation' && event.job === jobId)).toBe(true);
    // Logs identify the job and the stage; they never contain the article or the vocabulary.
    expect(lines.join('\n')).not.toMatch(/Climate|mitigate|scarce|resilient|initiative/u);
  }, 30_000);

  it('rewrites a draft that leaves targets out of the article and names them', async () => {
    useRealValidator();
    const { db, env, job } = await setup(topic);
    const missing = fixtureArticle();
    missing.paragraphs[2]!.text = missing.paragraphs[2]!.text.replace('resilient', 'strong');
    missing.paragraphs[1]!.text = missing.paragraphs[1]!.text.replace('initiative', 'plan');
    generated.mockResolvedValueOnce(missing).mockResolvedValueOnce(fixtureArticle());

    await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

    expect(generated).toHaveBeenCalledTimes(2);
    expect(generated.mock.calls[1]![0].revision.issues).toEqual([expect.stringContaining('t5 ("initiative"), t6 ("resilient")')]);
    expect(await readyRows(db)).toMatchObject({ status: 'ready', progress: 100, questions: 6, wellFormed: 6, located: 6 });
    expect(events().map((event) => `${event.stage}:${event.outcome ?? ''}`)).toEqual(
      ['start:', 'generate:ok', 'validate:unusable', 'generate:ok', 'validate:ok', 'done:', 'persisted:']);
    expect(events()[2]).toMatchObject({ codes: ['TARGET_MISSING'] });
  }, 30_000);

  it('completes the fourth draft instead of failing when targets are still missing, and the client can read it', async () => {
    useRealValidator();
    const { db, env, job } = await setup(topic);
    const missing = fixtureArticle();
    missing.paragraphs[2]!.text = missing.paragraphs[2]!.text.replace('resilient', 'strong');
    generated.mockResolvedValue(missing);

    await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

    expect(generated).toHaveBeenCalledTimes(4);
    expect(validated.mock.calls.map((call) => call[4])).toEqual([
      { completeMissing: false }, { completeMissing: false }, { completeMissing: false }, { completeMissing: true },
    ]);
    expect(await readyRows(db)).toMatchObject({ status: 'ready', progress: 100, questions: 6, wellFormed: 6, located: 6 });
    const stored = (await db.prepare('SELECT plain_text AS text FROM practice_paragraphs ORDER BY position DESC LIMIT 1')
      .first<{ text: string }>())!.text;
    expect(stored.endsWith('One expression worth remembering here is "resilient".')).toBe(true);
    expect(events().find((event) => event.stage === 'validate' && event.outcome === 'ok')).toMatchObject({ notes: ['TARGET_ADDED:t6'] });
    const practice = await readThroughApi(env);
    expect(practice.article!.paragraphs.flatMap((paragraph) => paragraph.segments).filter((segment) => segment.targetId !== null)).toHaveLength(6);
  }, 30_000);

  it('stores the repaired text when a slightly overlong draft is shortened in code', async () => {
    useRealValidator();
    const { db, env, job } = await setup(topic);
    generated.mockResolvedValue(fixtureOverlongArticle());

    await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

    expect(generated).toHaveBeenCalledTimes(1);
    expect(await readyRows(db)).toMatchObject({ status: 'ready', words: 300, paragraphs: 3, questions: 6, located: 6 });
    const stored = (await db.prepare('SELECT plain_text AS text FROM practice_paragraphs ORDER BY position')
      .all<{ text: string }>()).results.map((row: { text: string }) => row.text).join(' ');
    // Exactly one filler sentence was dropped; every target sentence is intact.
    expect(fixtureFillers.filter((sentence) => stored.includes(sentence))).toHaveLength(fixtureFillers.length - 1);
    for (const { term } of fixtureSpecs) expect(stored).toContain(term);
  }, 30_000);

  it('lets a long topic essay through and still labels it by its format, not its length', async () => {
    useRealValidator();
    const { db, env, job } = await setup(topic);
    const long = fixtureArticle();
    long.paragraphs[1]!.text += ` ${'The committee continued to discuss several unrelated proposals for many weeks '.repeat(8).trim()}.`;
    generated.mockResolvedValue(long);

    await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

    expect(generated).toHaveBeenCalledTimes(1);
    const row = await readyRows(db);
    expect(row).toMatchObject({ status: 'ready', version: 'ielts-topic-short-english-cloze-v5', wellFormed: 6, located: 6 });
    expect(row!.words as number).toBeGreaterThan(300);
    expect(events().find((event) => event.stage === 'validate')).toMatchObject({ notes: [expect.stringMatching(/^WORD_COUNT_HIGH:3\d\d$/)] });
  }, 30_000);

  it('fails at 40% with the unusable-content message only when every draft is unusable', async () => {
    useRealValidator();
    const { db, env, job } = await setup(topic);
    const empty = fixtureArticle();
    empty.paragraphs = [{ key: 'p1', text: '' }];
    generated.mockResolvedValue(empty);

    const error = await handlePracticeGeneration(env, job, { signal: new AbortController().signal })
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: 'AI_INVALID_OUTPUT', retryable: true });
    expect(generated).toHaveBeenCalledTimes(4);
    expect(generated.mock.calls[3]![0].revision.issues).toEqual([expect.stringContaining('empty or far too short')]);
    expect(await db.prepare('SELECT status, generation_progress AS progress FROM practice_sessions WHERE id = ?')
      .bind(practiceId).first()).toEqual({ status: 'generating', progress: 40 });

    await failPracticeGeneration(env, job, error as AppError, { signal: new AbortController().signal });
    expect(await db.prepare('SELECT status, failure_code AS code, failure_message_public AS message FROM practice_sessions WHERE id = ?')
      .bind(practiceId).first()).toEqual({ status: 'failed', code: 'AI_INVALID_OUTPUT', message: '生成的内容无法使用，请重试' });
    expect((await db.prepare("SELECT kind FROM usage_ledger WHERE kind IN ('commit', 'release')").all<{ kind: string }>()).results)
      .toEqual([{ kind: 'release' }]);
  }, 30_000);

  describe('an article with only a few targets', () => {
    const thin = { topic: '环境', terms: fixtureSpecs.slice(0, 2).map(({ term, meaningZh }) => ({ term, meaningZh })) };

    /** The fixture article answered with `perTarget` questions for each of its first two targets. */
    function draftAskingTwice(perTarget: number) {
      const draft = fixtureArticle();
      draft.questions = fixtureSpecs.slice(0, 2).flatMap(({ alias }) => {
        const base = fixtureArticle().questions.find((question) => question.targetAlias === alias)!;
        return [base, ...[...Array(perTarget - 1).keys()].map((index) => ({
          ...base, prompt: `Question ${index + 2} about ____ for ${alias}.`,
        }))];
      });
      return draft;
    }

    it('asks for six questions in all, stores every round and reads them back round by round', async () => {
      useRealValidator();
      const { db, env, job } = await setup(thin);
      generated.mockResolvedValue(draftAskingTwice(3));

      await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

      // The model is told how many questions each target gets, and so is the validator.
      expect(generated.mock.calls[0]![0].targets.map((target: { questionCount?: number }) => target.questionCount)).toEqual([3, 3]);
      expect(validated.mock.calls[0]![2].map((target: { questionCount?: number }) => target.questionCount)).toEqual([3, 3]);
      expect(await readyRows(db)).toMatchObject({ status: 'ready', questions: 6, wellFormed: 6 });
      expect((await db.prepare('SELECT round, count(*) AS count FROM practice_questions GROUP BY round ORDER BY round').all()).results)
        .toEqual([{ round: 0, count: 2 }, { round: 1, count: 2 }, { round: 2, count: 2 }]);
      // The same target is never asked twice in a row, and the client contract accepts all six.
      const practice = await readThroughApi(env);
      expect(practice.questions.map((question) => question.prompt)).toEqual([
        fixtureSpecs[0]!.prompt, fixtureSpecs[1]!.prompt,
        'Question 2 about ____ for t1.', 'Question 2 about ____ for t2.',
        'Question 3 about ____ for t1.', 'Question 3 about ____ for t2.',
      ]);
      expect(practice.questions.map((question) => question.term)).toEqual(['mitigate', 'sustainable', 'mitigate', 'sustainable', 'mitigate', 'sustainable']);
      expect(new Set(practice.questions.map((question) => question.id)).size).toBe(6);
      expect(events()[0]).toMatchObject({ stage: 'start', targets: 2, questions: 6 });
      expect(events().at(-1)).toMatchObject({ stage: 'persisted', questions: 6 });
    }, 30_000);

    it('stores what the model wrote when it ignores the plan, instead of failing the practice', async () => {
      useRealValidator();
      const { db, env, job } = await setup(thin);
      generated.mockResolvedValue(draftAskingTwice(1));

      await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

      expect(generated).toHaveBeenCalledTimes(1);
      expect(await readyRows(db)).toMatchObject({ status: 'ready', questions: 2, wellFormed: 2 });
      expect(events().find((event) => event.stage === 'validate')).toMatchObject({
        outcome: 'ok', notes: ['QUESTIONS_SHORT:t1:1/3', 'QUESTIONS_SHORT:t2:1/3'],
      });
      expect((await readThroughApi(env)).questions).toHaveLength(2);
    }, 30_000);

    it('does not plan extra questions when the article has enough targets', async () => {
      useRealValidator();
      const { db, env, job } = await setup(topic);
      generated.mockResolvedValue(fixtureArticle());

      await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

      expect(generated.mock.calls[0]![0].targets.every((target: object) => !('questionCount' in target))).toBe(true);
      expect(validated.mock.calls[0]![2].map((target: { questionCount?: number }) => target.questionCount)).toEqual([1, 1, 1, 1, 1, 1]);
      expect(await readyRows(db)).toMatchObject({ questions: 6 });
      expect(events()[0]).toMatchObject({ stage: 'start', targets: 6, questions: 6 });
    }, 30_000);
  });

  it('rides out a rate-limited provider without restarting the job', async () => {
    useRealValidator();
    const { db, env, job } = await setup(topic);
    generated.mockRejectedValueOnce(new AppError('AI_UNAVAILABLE', 'rate limited', 503, true))
      .mockResolvedValue(fixtureArticle());

    await handlePracticeGeneration(env, job, { signal: new AbortController().signal });

    expect(generated).toHaveBeenCalledTimes(2);
    expect(await readyRows(db)).toMatchObject({ status: 'ready', progress: 100 });
  }, 30_000);
});
