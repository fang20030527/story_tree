import {
  RetryFailedTopicsRequestSchema,
  RetryFailedTopicsResponseSchema,
  UuidSchema,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { MAX_TARGETS_PER_ARTICLE } from '../../../../server/src/modules/practice/topic-targets';
import { generationDeadlineMs } from '../ai/provider';
import { readJsonBody } from '../core/http';
import type { ApiEnv, D1DatabaseBinding, D1StatementBinding } from '../env';
import { RETRYABLE_GENERATION_CODES, SUCCESSFUL_STATUSES } from './read';

const PATH = /^\/v1\/practices\/([^/]+)\/retry-failed$/u;
const OPERATION = 'retry_failed_topics';
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
/** A first-run job has max_attempts 3; a refilled one gets more, so each slot is refilled once. */
const FIRST_RUN_MAX_ATTEMPTS = 3;

interface RecordRow { requestHash: string; resourceId: string }
interface MemberRow { id: string; status: string; failureCode: string | null; position: number | null }
interface JobRow { id: string; resourceId: string; attemptCount: number; maxAttempts: number; status: string }
interface TargetRow { id: string; practiceId: string }

function parseGroupId(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', '主题练习编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(decoded).success) {
    throw new AppError('VALIDATION_ERROR', '主题练习编号格式无效', 400);
  }
  return decoded;
}

function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key');
  if (!key || !KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  return key;
}

async function requestHash(groupId: string): Promise<string> {
  // Same canonical encoding as the other idempotent routes; one key needs no sorting.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ groupId })));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function findRecord(db: D1DatabaseBinding, userId: string, key: string): Promise<RecordRow | null> {
  return db.prepare(`
    SELECT request_hash AS requestHash, resource_id AS resourceId
    FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `).bind(userId, OPERATION, key).first<RecordRow>();
}

function replayed(record: RecordRow, hash: string): Response {
  if (record.requestHash !== hash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  return accepted(record.resourceId);
}

function accepted(groupId: string): Response {
  return Response.json(RetryFailedTopicsResponseSchema.parse({ groupId }), {
    headers: { 'cache-control': 'no-store' },
  });
}

function claimedRows(result: unknown): unknown[] {
  if (!result || typeof result !== 'object' || !('results' in result) || !Array.isArray(result.results)) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时无法访问', 503, true);
  }
  return result.results;
}

/** Targets kept when a legacy set is larger than a short article can hold. */
function keptTargets(targets: readonly TargetRow[], topicPosition: number): string[] | null {
  if (targets.length <= MAX_TARGETS_PER_ARTICLE) return null;
  const start = topicPosition * MAX_TARGETS_PER_ARTICLE % targets.length;
  return Array.from({ length: MAX_TARGETS_PER_ARTICLE }, (_, index) => targets[(start + index) % targets.length]!.id);
}

/**
 * POST /v1/practices/:groupId/retry-failed. A topic group with at least one readable article
 * may refill the slots that failed for a transient reason, once each. The refill does not spend
 * quota: the group's reservation was already committed by the successful article.
 */
export async function handlePracticeRetryFailedRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const match = PATH.exec(new URL(request.url).pathname);
  if (!match) return null;
  const groupId = parseGroupId(match[1]!);
  const key = requireIdempotencyKey(request);
  if (!RetryFailedTopicsRequestSchema.safeParse(await readJsonBody(request)).success) {
    throw new AppError('VALIDATION_ERROR', '请检查重试请求', 400);
  }
  const hash = await requestHash(groupId);
  const previous = await findRecord(env.DB, userId, key);
  if (previous) return replayed(previous, hash);

  const members = (await env.DB.prepare(`
    SELECT id, status, failure_code AS failureCode, topic_position AS position
    FROM practice_sessions WHERE topic_group_id = ?1 AND user_id = ?2
    ORDER BY topic_position IS NULL, topic_position ASC, id ASC
  `).bind(groupId, userId).all<MemberRow>()).results;
  if (!members.some((member) => member.id === groupId)) {
    throw new AppError('NOT_FOUND', '主题练习不存在', 404);
  }
  if (!members.some((member) => SUCCESSFUL_STATUSES.has(member.status))) {
    throw new AppError('STATE_CONFLICT', '请重新创建一组短文', 409);
  }
  const failed = members.filter((member) => member.status === 'failed'
    && RETRYABLE_GENERATION_CODES.has(member.failureCode ?? ''));
  if (failed.length === 0) throw new AppError('STATE_CONFLICT', '没有可重试的短文', 409);

  const failedIds = failed.map((member) => member.id);
  const marks = failedIds.map(() => '?').join(', ');
  const [jobRows, targetRows] = await Promise.all([
    env.DB.prepare(`
      SELECT id, resource_id AS resourceId, attempt_count AS attemptCount,
        max_attempts AS maxAttempts, status
      FROM jobs WHERE kind = 'practice_generation' AND resource_id IN (${marks})
      ORDER BY created_at, id
    `).bind(...failedIds).all<JobRow>(),
    env.DB.prepare(`
      SELECT id, practice_session_id AS practiceId FROM practice_targets
      WHERE practice_session_id IN (${marks}) ORDER BY position, id
    `).bind(...failedIds).all<TargetRow>(),
  ]);
  const eligible = new Map<string, JobRow>();
  for (const job of jobRows.results) {
    if (job.status === 'failed' && job.maxAttempts === FIRST_RUN_MAX_ATTEMPTS && !eligible.has(job.resourceId)) {
      eligible.set(job.resourceId, job);
    }
  }
  if (eligible.size === 0) throw new AppError('STATE_CONFLICT', '这些短文已达到重试上限', 409);

  const now = new Date();
  const recordId = crypto.randomUUID();
  const deadlineAt = new Date(now.getTime() + generationDeadlineMs(env) * 4).toISOString();
  const owned = 'EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)';
  const statements: D1StatementBinding[] = [env.DB.prepare(`
    INSERT INTO idempotency_records
      (id, user_id, operation, idempotency_key, request_hash,
       resource_type, resource_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'practice', ?, ?, ?)
    ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
    RETURNING id
  `).bind(recordId, userId, OPERATION, key, hash, groupId, now.toISOString(),
    new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString())];

  for (const job of eligible.values()) {
    const guardId = crypto.randomUUID();
    // A failed CHECK aborts the whole batch, so a slot that another request refilled (or that
    // changed state since it was read) cannot be queued twice. Without the claim, nothing runs.
    statements.push(env.DB.prepare(`
      INSERT INTO transaction_guards (id, valid)
      VALUES (?, CASE WHEN NOT ${owned} OR (
        EXISTS (SELECT 1 FROM jobs WHERE id = ? AND kind = 'practice_generation'
          AND status = 'failed' AND max_attempts = ?)
        AND EXISTS (SELECT 1 FROM practice_sessions WHERE id = ? AND user_id = ?
          AND topic_group_id = ? AND status = 'failed')
      ) THEN 1 ELSE 0 END)
    `).bind(guardId, recordId, job.id, FIRST_RUN_MAX_ATTEMPTS, job.resourceId, userId, groupId));

    const member = failed.find((entry) => entry.id === job.resourceId)!;
    const keep = keptTargets(targetRows.results.filter((target) => target.practiceId === job.resourceId),
      member.position ?? 0);
    if (keep) {
      statements.push(env.DB.prepare(`
        DELETE FROM practice_targets
        WHERE practice_session_id = ? AND id NOT IN (${keep.map(() => '?').join(', ')}) AND ${owned}
      `).bind(job.resourceId, ...keep, recordId));
    }
    statements.push(env.DB.prepare(`
      UPDATE practice_sessions
      SET status = 'queued', generation_progress = 0,
        failure_code = NULL, failure_message_public = NULL
      WHERE id = ? AND user_id = ? AND status = 'failed' AND ${owned}
    `).bind(job.resourceId, userId, recordId));
    statements.push(env.DB.prepare(`
      UPDATE jobs
      SET status = 'queued', max_attempts = ?, available_at = ?, deadline_at = ?,
        locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
        last_error_code = NULL, finished_at = NULL
      WHERE id = ? AND status = 'failed' AND ${owned}
    `).bind(Math.max(FIRST_RUN_MAX_ATTEMPTS + 1, job.attemptCount + 3), now.toISOString(),
      deadlineAt, job.id, recordId));
    statements.push(env.DB.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(guardId));
  }

  let results: unknown[];
  try {
    results = await env.DB.batch(statements);
  } catch {
    // A concurrent same-key request may have committed first; otherwise the group changed.
    const raced = await findRecord(env.DB, userId, key);
    if (raced) return replayed(raced, hash);
    throw new AppError('STATE_CONFLICT', '短文状态已变化，请刷新后重试', 409, true);
  }
  if (claimedRows(results[0]).length === 0) {
    const raced = await findRecord(env.DB, userId, key);
    if (!raced) throw new AppError('STATE_CONFLICT', '重试状态正在更新，请稍后重试', 409, true);
    return replayed(raced, hash);
  }
  // D1 is the source of truth: the Cron pass dispatches any job whose message is lost.
  await Promise.allSettled([...eligible.values()].map((job) => env.JOB_QUEUE?.send({ jobId: job.id })));
  return accepted(groupId);
}
