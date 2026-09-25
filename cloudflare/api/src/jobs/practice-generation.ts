import { PracticeTopicSchema, type PracticeStatus } from '@context-reader/contracts';

import { AppError, type ErrorCode } from '../../../../server/src/core/errors';
import type { GeneratePracticeInput } from '../../../../server/src/infrastructure/ai/types';
import {
  PracticeValidationError,
  type GenerationTarget,
  type ValidatedGeneratedPractice,
} from '../../../../server/src/modules/practice/generation-validator';
import { evolinkProvider } from '../ai/provider';
import { validatePracticeOnCpuBoundary } from '../cpu/client';
import type { ApiEnv, D1DatabaseBinding, D1StatementBinding } from '../env';
import type { ClaimedJob } from './repository';

const MAX_DRAFTS = 4;
const DB_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const TERMINAL_SUCCESS = new Set<PracticeStatus>(['ready', 'in_progress', 'completed']);
const DEFAULT_PROMPT_VERSION = 'ielts-generation-bilingual-feedback-v4';

interface PracticeRow {
  status: PracticeStatus;
  examPath: 'ielts';
  topic: string | null;
  topicGroupId: string | null;
}

interface TargetRow {
  id: string;
  term: string;
  meaningZh: string;
  sourceSentence: string | null;
}

interface LoadedInput {
  status: PracticeStatus;
  rootId: string;
  providerInput: GeneratePracticeInput;
  validationTargets: GenerationTarget[];
}

function stateConflict(): AppError {
  return new AppError('STATE_CONFLICT', '练习状态已变更', 409);
}

function leaseLost(): DOMException {
  return new DOMException('Job lease lost', 'AbortError');
}

function assertDeadline(job: ClaimedJob, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (Date.now() >= job.deadlineAt.getTime()) {
    throw new AppError('GENERATION_DEADLINE_EXCEEDED', '练习生成已超过截止时间', 504);
  }
}

async function loadInput(db: D1DatabaseBinding, practiceId: string): Promise<LoadedInput> {
  const practice = await db.prepare(
    'SELECT status, exam_path AS examPath, topic, topic_group_id AS topicGroupId ' +
    'FROM practice_sessions WHERE id = ? LIMIT 1',
  ).bind(practiceId).first<PracticeRow>();
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
  const rootId = practice.topicGroupId ?? practiceId;
  if (TERMINAL_SUCCESS.has(practice.status)) {
    return {
      status: practice.status,
      rootId,
      providerInput: { examPath: practice.examPath, targets: [] },
      validationTargets: [],
    };
  }
  const targets = await db.prepare(
    'SELECT target.id, item.term, item.meaning_zh AS meaningZh, ' +
    'item.source_sentence AS sourceSentence ' +
    'FROM practice_targets AS target JOIN vocabulary_items AS item ' +
    'ON item.id = target.vocabulary_item_id ' +
    'WHERE target.practice_session_id = ? ORDER BY target.position',
  ).bind(practiceId).all<TargetRow>();
  if (targets.results.length === 0) {
    throw new AppError('INTERNAL_ERROR', '练习目标不存在', 500, true);
  }
  return {
    status: practice.status,
    rootId,
    providerInput: {
      examPath: practice.examPath,
      ...(practice.topic ? { topic: PracticeTopicSchema.parse(practice.topic) } : {}),
      targets: targets.results.map((target, index) => ({
        alias: 't' + (index + 1),
        term: target.term,
        meaningZh: target.meaningZh,
        ...(target.sourceSentence === null ? {} : { sourceSentence: target.sourceSentence }),
      })),
    },
    validationTargets: targets.results.map((target, index) => ({
      id: target.id,
      alias: 't' + (index + 1),
      meaningZh: target.meaningZh,
    })),
  };
}

function leasedStateSql(allowed: string): string {
  return [
    'UPDATE practice_sessions SET status = ?,',
    'generation_progress = max(generation_progress, ?)',
    'WHERE id = ? AND status IN (' + allowed + ')',
    'AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND kind = ?',
    'AND resource_id = practice_sessions.id AND status = \'running\'',
    'AND locked_by = ? AND lease_expires_at > ' + DB_NOW + ')',
    'RETURNING id',
  ].join(' ');
}

async function moveState(
  db: D1DatabaseBinding,
  job: ClaimedJob,
  nextStatus: 'generating' | 'validating',
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const allowed = nextStatus === 'generating'
    ? "'queued', 'generating', 'validating'"
    : "'generating', 'validating'";
  const progress = nextStatus === 'generating' ? 10 : 60;
  const changed = await db.prepare(leasedStateSql(allowed))
    .bind(nextStatus, progress, job.resourceId, job.id, job.kind, job.lockedBy)
    .first<{ id: string }>();
  if (changed) return true;
  const current = await db.prepare(
    'SELECT status FROM practice_sessions WHERE id = ? LIMIT 1',
  ).bind(job.resourceId).first<{ status: PracticeStatus }>();
  if (current && TERMINAL_SUCCESS.has(current.status)) return false;
  throw stateConflict();
}

async function recordProgress(
  db: D1DatabaseBinding,
  job: ClaimedJob,
  progress: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const changed = await db.prepare(
    'UPDATE practice_sessions SET generation_progress = max(generation_progress, ?) ' +
    'WHERE id = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND kind = ? ' +
    'AND resource_id = practice_sessions.id AND status = \'running\' ' +
    'AND locked_by = ? AND lease_expires_at > ' + DB_NOW + ') RETURNING id',
  ).bind(progress, job.resourceId, job.id, job.kind, job.lockedBy).first<{ id: string }>();
  if (!changed) throw leaseLost();
}

function guardStatement(db: D1DatabaseBinding, guardId: string, job: ClaimedJob, statuses: string): D1StatementBinding {
  // A failed CHECK in transaction_guards aborts every statement in the batch.
  // A conditional UPDATE returning zero rows would not have this property.
  return db.prepare(
    'INSERT INTO transaction_guards (id, valid) VALUES (?, CASE WHEN ' +
    'EXISTS (SELECT 1 FROM jobs WHERE id = ? AND kind = \'practice_generation\' ' +
    'AND resource_id = ? AND status = \'running\' AND locked_by = ? ' +
    'AND lease_expires_at > ' + DB_NOW + ') AND ' +
    'EXISTS (SELECT 1 FROM practice_sessions WHERE id = ? AND status IN (' + statuses + ')) ' +
    'THEN 1 ELSE 0 END)',
  ).bind(guardId, job.id, job.resourceId, job.lockedBy, job.resourceId);
}

function settlementStatements(db: D1DatabaseBinding, rootId: string): D1StatementBinding[] {
  const allDone = [
    'NOT EXISTS (SELECT 1 FROM practice_sessions AS member',
    'WHERE (member.id = root.id OR member.topic_group_id = root.id)',
    "AND member.status NOT IN ('ready', 'in_progress', 'completed', 'failed'))",
  ].join(' ');
  const anySucceeded = [
    'EXISTS (SELECT 1 FROM practice_sessions AS member',
    'WHERE (member.id = root.id OR member.topic_group_id = root.id)',
    "AND member.status IN ('ready', 'in_progress', 'completed'))",
  ].join(' ');
  const noFinalization = [
    'NOT EXISTS (SELECT 1 FROM usage_ledger AS final',
    "WHERE final.practice_session_id = root.id AND final.kind IN ('commit', 'release'))",
  ].join(' ');
  const reserveExists = [
    'EXISTS (SELECT 1 FROM usage_ledger AS reserved',
    "WHERE reserved.practice_session_id = root.id AND reserved.kind = 'reserve')",
  ].join(' ');
  function statement(kind: 'commit' | 'release', successPredicate: string): D1StatementBinding {
    return db.prepare([
      'INSERT INTO usage_ledger',
      '(id, user_id, practice_session_id, kind, amount, operation_key)',
      "SELECT ?, root.user_id, root.id, '" + kind + "', " + (kind === 'commit' ? '0' : '1') + ', ?',
      'FROM practice_sessions AS root WHERE root.id = ?',
      'AND ' + allDone,
      'AND ' + successPredicate,
      'AND ' + reserveExists,
      'AND ' + noFinalization,
      'ON CONFLICT(operation_key) DO NOTHING',
    ].join(' ')).bind(crypto.randomUUID(), rootId + ':' + kind, rootId);
  }
  return [statement('commit', anySucceeded), statement('release', 'NOT ' + anySucceeded)];
}

function outputRows(validated: ValidatedGeneratedPractice): {
  paragraphs: string;
  usages: string;
  questions: string;
} {
  const paragraphIds = new Map<string, string>();
  const paragraphs = validated.paragraphs.map((paragraph, position) => {
    const id = crypto.randomUUID();
    paragraphIds.set(paragraph.key, id);
    return { id, position, text: paragraph.text };
  });
  const usages = validated.usages.map((usage) => ({
    targetId: usage.targetId,
    paragraphId: paragraphIds.get(usage.paragraphKey),
    surfaceForm: usage.surfaceForm,
    startOffset: usage.startOffset,
    endOffset: usage.endOffset,
  }));
  if (usages.some((usage) => !usage.paragraphId)) {
    throw new AppError('AI_INVALID_OUTPUT', '生成内容未通过结构检查', 502, true);
  }
  const questions = validated.questions.map((question) => {
    const options = question.optionsEn.map((label) => ({ id: crypto.randomUUID(), label }));
    const correctOptionId = options[question.correctOptionIndex]?.id;
    if (!correctOptionId) {
      throw new AppError('AI_INVALID_OUTPUT', '生成内容未通过结构检查', 502, true);
    }
    const optionExplanations = Object.fromEntries(options.map((option, index) => [
      option.id,
      question.optionExplanationsZh[index] + '\n' + question.optionExplanationsEn[index],
    ]));
    return {
      id: crypto.randomUUID(),
      targetId: question.targetId,
      prompt: question.prompt,
      optionsJson: JSON.stringify(options),
      correctOptionId,
      meaningEn: question.meaningEn,
      explanationZh: question.explanationZh,
      optionExplanationsJson: JSON.stringify(optionExplanations),
    };
  });
  return {
    paragraphs: JSON.stringify(paragraphs),
    usages: JSON.stringify(usages),
    questions: JSON.stringify(questions),
  };
}

async function persistReady(
  env: ApiEnv,
  job: ClaimedJob,
  rootId: string,
  validated: ValidatedGeneratedPractice,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const guardId = crypto.randomUUID();
  const output = outputRows(validated);
  const promptVersion = validated.wordCount <= 300
    ? 'ielts-topic-short-english-cloze-v3' : DEFAULT_PROMPT_VERSION;
  const modelName = env.EVOLINK_TEXT_MODEL ?? 'gpt-6-luna';
  const db = env.DB;
  const statements: D1StatementBinding[] = [
    guardStatement(db, guardId, job, "'validating'"),
    db.prepare([
      'INSERT INTO practice_paragraphs (id, practice_session_id, position, plain_text)',
      "SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.position'),",
      "json_extract(value, '$.text') FROM json_each(?)",
    ].join(' ')).bind(job.resourceId, output.paragraphs),
    db.prepare([
      'UPDATE practice_targets SET',
      '(paragraph_id, surface_form, start_offset, end_offset) =',
      '(SELECT json_extract(value, \'$.paragraphId\'),',
      'json_extract(value, \'$.surfaceForm\'),',
      'json_extract(value, \'$.startOffset\'),',
      'json_extract(value, \'$.endOffset\') FROM json_each(?)',
      "WHERE json_extract(value, '$.targetId') = practice_targets.id)",
      'WHERE practice_session_id = ?',
      "AND id IN (SELECT json_extract(value, '$.targetId') FROM json_each(?))",
    ].join(' ')).bind(output.usages, job.resourceId, output.usages),
    db.prepare([
      'INSERT INTO practice_questions',
      '(id, practice_target_id, prompt, options_json, correct_option_id,',
      'meaning_en, explanation_zh, option_explanations_json)',
      "SELECT json_extract(value, '$.id'), json_extract(value, '$.targetId'),",
      "json_extract(value, '$.prompt'), json_extract(value, '$.optionsJson'),",
      "json_extract(value, '$.correctOptionId'), json_extract(value, '$.meaningEn'),",
      "json_extract(value, '$.explanationZh'),",
      "json_extract(value, '$.optionExplanationsJson') FROM json_each(?)",
    ].join(' ')).bind(output.questions),
    db.prepare(
      "UPDATE practice_sessions SET status = 'ready', generation_progress = 100, " +
      'article_title = ?, article_word_count = ?, model_name = ?, prompt_version = ?, ' +
      'failure_code = NULL, failure_message_public = NULL, ready_at = ' + DB_NOW +
      ' WHERE id = ?',
    ).bind(validated.title, validated.wordCount, modelName, promptVersion, job.resourceId),
    ...settlementStatements(db, rootId),
    db.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(guardId),
  ];
  await db.batch(statements);
}

export async function handlePracticeGeneration(
  env: ApiEnv,
  job: ClaimedJob,
  context: { signal: AbortSignal },
): Promise<void> {
  if (job.kind !== 'practice_generation') {
    throw new AppError('INTERNAL_ERROR', '任务类型无效', 500);
  }
  const loaded = await loadInput(env.DB, job.resourceId);
  if (TERMINAL_SUCCESS.has(loaded.status)) return;
  if (loaded.status === 'failed') throw stateConflict();
  assertDeadline(job, context.signal);
  if (!(await moveState(env.DB, job, 'generating', context.signal))) return;
  const provider = evolinkProvider(env);
  let input = loaded.providerInput;
  for (let revision = 0; revision < MAX_DRAFTS; revision += 1) {
    assertDeadline(job, context.signal);
    const generated = await provider.generatePractice(input, context.signal);
    await recordProgress(env.DB, job, 40, context.signal);
    let validated: ValidatedGeneratedPractice;
    try {
      validated = await validatePracticeOnCpuBoundary(
        env, generated, loaded.validationTargets,
        loaded.providerInput.topic ? 'short' : 'long',
      );
    } catch (error) {
      if (!(error instanceof PracticeValidationError) || revision === MAX_DRAFTS - 1) throw error;
      input = {
        ...loaded.providerInput,
        revision: { generated, issues: [error.repairIssue] },
      };
      continue;
    }
    if (!(await moveState(env.DB, job, 'validating', context.signal))) return;
    assertDeadline(job, context.signal);
    const verification = await provider.verifyPractice(
      { ...loaded.providerInput, generated }, context.signal,
    );
    if (!verification.approved) {
      if (revision === MAX_DRAFTS - 1) {
        throw new AppError('AI_INVALID_OUTPUT', '生成内容未通过质量检查', 502, true);
      }
      input = {
        ...loaded.providerInput,
        revision: { generated, issues: verification.issues },
      };
      if (!(await moveState(env.DB, job, 'generating', context.signal))) return;
      continue;
    }
    await recordProgress(env.DB, job, 90, context.signal);
    assertDeadline(job, context.signal);
    await persistReady(env, job, loaded.rootId, validated, context.signal);
    return;
  }
}

function publicFailure(error: AppError): { code: ErrorCode; message: string } {
  switch (error.code) {
    case 'AI_CONTENT_REJECTED':
      return { code: error.code, message: '内容未通过安全检查，请调整输入后重试' };
    case 'GENERATION_DEADLINE_EXCEEDED':
      return { code: error.code, message: '练习生成超时，请重试' };
    case 'AI_INVALID_OUTPUT':
      return { code: error.code, message: '生成内容未通过质量检查，请重试' };
    case 'AI_UNAVAILABLE':
      return { code: error.code, message: 'AI 服务暂时不可用，请稍后重试' };
    default:
      return { code: 'INTERNAL_ERROR', message: '练习暂时无法生成，请稍后重试' };
  }
}

export async function failPracticeGeneration(
  env: ApiEnv,
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
): Promise<void> {
  if (job.kind !== 'practice_generation') {
    throw new AppError('INTERNAL_ERROR', '任务类型无效', 500);
  }
  context.signal.throwIfAborted();
  const current = await env.DB.prepare(
    'SELECT status, topic_group_id AS topicGroupId FROM practice_sessions WHERE id = ? LIMIT 1',
  ).bind(job.resourceId).first<{ status: PracticeStatus; topicGroupId: string | null }>();
  if (!current) throw new AppError('NOT_FOUND', '练习不存在', 404);
  if (TERMINAL_SUCCESS.has(current.status) || current.status === 'failed') return;
  const rootId = current.topicGroupId ?? job.resourceId;
  const failure = publicFailure(error);
  const guardId = crypto.randomUUID();
  await env.DB.batch([
    guardStatement(env.DB, guardId, job, "'queued', 'generating', 'validating'"),
    env.DB.prepare(
      "UPDATE practice_sessions SET status = 'failed', failure_code = ?, " +
      'failure_message_public = ? WHERE id = ?',
    ).bind(failure.code, failure.message, job.resourceId),
    ...settlementStatements(env.DB, rootId),
    env.DB.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(guardId),
  ]);
}
