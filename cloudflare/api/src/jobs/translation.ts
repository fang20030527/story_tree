import { AppError } from '../../../../server/src/core/errors';
import { validateTranslationText } from '../../../../server/src/modules/translation/validation';
import { evolinkProvider } from '../ai/provider';
import type { ApiEnv, D1DatabaseBinding } from '../env';
import type { ClaimedJob } from './repository';

type TranslationKind = 'translation' | 'article_translation';
type TranslationStatus = 'queued' | 'generating' | 'ready' | 'failed';

interface TranslationContext {
  signal: AbortSignal;
}

interface TranslationRow {
  parentId: string;
  scope: 'paragraph' | 'full';
  paragraphId: string | null;
  status: TranslationStatus;
}

interface SourceParagraphRow {
  plainText: string;
}

const TABLES = {
  translation: {
    translation: 'translations',
    paragraph: 'practice_paragraphs',
    parentColumn: 'practice_session_id',
  },
  article_translation: {
    translation: 'article_translations',
    paragraph: 'article_paragraphs',
    parentColumn: 'article_id',
  },
} as const;

const DB_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
// ?1 resource id, ?2 job id, ?3 kind, ?4 worker id. Every state write
// checks its lease in that same SQL statement, so a stale worker cannot write.
const ACTIVE_LEASE = `
  job.id = ?2 AND job.resource_id = ?1 AND job.kind = ?3
  AND job.status = 'running' AND job.locked_by = ?4
  AND job.lease_expires_at > ${DB_NOW}
`;

export async function handleTranslation(
  env: ApiEnv,
  job: ClaimedJob,
  context: TranslationContext,
): Promise<void> {
  return handleTranslationKind(env, 'translation', job, context);
}

export async function handleArticleTranslation(
  env: ApiEnv,
  job: ClaimedJob,
  context: TranslationContext,
): Promise<void> {
  return handleTranslationKind(env, 'article_translation', job, context);
}

export async function failTranslation(
  env: ApiEnv,
  job: ClaimedJob,
  error: AppError,
  context: TranslationContext,
): Promise<void> {
  return failTranslationKind(env.DB, 'translation', job, error, context.signal);
}

export async function failArticleTranslation(
  env: ApiEnv,
  job: ClaimedJob,
  error: AppError,
  context: TranslationContext,
): Promise<void> {
  return failTranslationKind(env.DB, 'article_translation', job, error, context.signal);
}

async function handleTranslationKind(
  env: ApiEnv,
  kind: TranslationKind,
  job: ClaimedJob,
  context: TranslationContext,
): Promise<void> {
  assertJobKind(job, kind);
  const loaded = await loadTranslation(env.DB, kind, job.resourceId);
  if (loaded.status === 'ready') return;
  if (loaded.status === 'failed') throw stateConflict();
  if (!(await moveToGenerating(env.DB, kind, job, context.signal))) return;

  assertWithinDeadline(job, context.signal);
  const translatedText = validateTranslationText(
    await evolinkProvider(env).translate(loaded.sourceText, context.signal),
    loaded.sourceText,
  );
  assertWithinDeadline(job, context.signal);
  await persistReady(env.DB, kind, job, translatedText, context.signal);
}

async function loadTranslation(
  db: D1DatabaseBinding,
  kind: TranslationKind,
  translationId: string,
): Promise<{ status: TranslationStatus; sourceText: string }> {
  const tables = TABLES[kind];
  const translation = await db.prepare(`
    SELECT ${tables.parentColumn} AS parentId, scope, paragraph_id AS paragraphId, status
    FROM ${tables.translation} WHERE id = ? LIMIT 1
  `).bind(translationId).first<TranslationRow>();
  if (!translation) throw new AppError('NOT_FOUND', '翻译不存在', 404);
  if (translation.status === 'ready' || translation.status === 'failed') {
    return { status: translation.status, sourceText: '' };
  }

  if (translation.scope === 'paragraph') {
    if (!translation.paragraphId) throw invalidSource();
    const paragraph = await db.prepare(`
      SELECT plain_text AS plainText FROM ${tables.paragraph}
      WHERE id = ?1 AND ${tables.parentColumn} = ?2 LIMIT 1
    `).bind(translation.paragraphId, translation.parentId).first<SourceParagraphRow>();
    if (!paragraph) throw invalidSource();
    return { status: translation.status, sourceText: paragraph.plainText };
  }

  if (translation.scope !== 'full') throw invalidSource();
  const paragraphs = await db.prepare(`
    SELECT plain_text AS plainText FROM ${tables.paragraph}
    WHERE ${tables.parentColumn} = ? ORDER BY position ASC
  `).bind(translation.parentId).all<SourceParagraphRow>();
  if (paragraphs.results.length === 0) throw invalidSource();
  return {
    status: translation.status,
    sourceText: paragraphs.results.map(({ plainText }) => plainText).join('\n\n'),
  };
}

async function moveToGenerating(
  db: D1DatabaseBinding,
  kind: TranslationKind,
  job: ClaimedJob,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const row = await db.prepare(`
    UPDATE ${TABLES[kind].translation} SET status = 'generating'
    WHERE id = ?1 AND status IN ('queued', 'generating')
      AND EXISTS (SELECT 1 FROM jobs AS job WHERE ${ACTIVE_LEASE})
    RETURNING id
  `).bind(job.resourceId, job.id, kind, job.lockedBy).first<{ id: string }>();
  if (row) return true;
  const status = await statusWithActiveLease(db, kind, job);
  if (status === 'ready') return false;
  throw stateConflict();
}

async function persistReady(
  db: D1DatabaseBinding,
  kind: TranslationKind,
  job: ClaimedJob,
  translatedText: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const extra = kind === 'article_translation'
    ? ', failure_code = NULL, failure_message_public = NULL'
    : '';
  const row = await db.prepare(`
    UPDATE ${TABLES[kind].translation}
    SET status = 'ready', translated_text_zh = ?5,
      ready_at = ${DB_NOW}${extra}
    WHERE id = ?1 AND status IN ('queued', 'generating')
      AND EXISTS (SELECT 1 FROM jobs AS job WHERE ${ACTIVE_LEASE})
    RETURNING id
  `).bind(job.resourceId, job.id, kind, job.lockedBy, translatedText)
    .first<{ id: string }>();
  if (row) return;
  const status = await statusWithActiveLease(db, kind, job);
  if (status !== 'ready') throw stateConflict();
}

async function failTranslationKind(
  db: D1DatabaseBinding,
  kind: TranslationKind,
  job: ClaimedJob,
  error: AppError,
  signal: AbortSignal,
): Promise<void> {
  assertJobKind(job, kind);
  signal.throwIfAborted();
  const extra = kind === 'article_translation'
    ? ", failure_code = ?5, failure_message_public = '翻译暂时无法完成'"
    : '';
  const row = await db.prepare(`
    UPDATE ${TABLES[kind].translation}
    SET status = 'failed', translated_text_zh = NULL, ready_at = NULL${extra}
    WHERE id = ?1 AND status IN ('queued', 'generating')
      AND EXISTS (SELECT 1 FROM jobs AS job WHERE ${ACTIVE_LEASE})
    RETURNING id
  `).bind(job.resourceId, job.id, kind, job.lockedBy,
    ...(kind === 'article_translation' ? [error.code] : []))
    .first<{ id: string }>();
  if (row) return;
  const status = await statusWithActiveLease(db, kind, job);
  if (status !== 'ready' && status !== 'failed') throw stateConflict();
}

async function statusWithActiveLease(
  db: D1DatabaseBinding,
  kind: TranslationKind,
  job: ClaimedJob,
): Promise<TranslationStatus> {
  const row = await db.prepare(`
    SELECT (SELECT status FROM ${TABLES[kind].translation} WHERE id = ?1) AS status
    FROM jobs AS job WHERE ${ACTIVE_LEASE} LIMIT 1
  `).bind(job.resourceId, job.id, kind, job.lockedBy)
    .first<{ status: TranslationStatus | null }>();
  if (!row) throw new DOMException('Job lease lost', 'AbortError');
  if (row.status === null) throw new AppError('NOT_FOUND', '翻译不存在', 404);
  return row.status;
}

function assertJobKind(job: ClaimedJob, kind: TranslationKind): void {
  if (job.kind !== kind) {
    throw new AppError('INTERNAL_ERROR', '任务类型无效', 500);
  }
}

function assertWithinDeadline(job: ClaimedJob, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (Date.now() >= job.deadlineAt.getTime()) {
    throw new AppError('GENERATION_DEADLINE_EXCEEDED', '翻译任务已超过截止时间', 504);
  }
}

function invalidSource(): AppError {
  return new AppError('INTERNAL_ERROR', '翻译来源无效', 500, true);
}

function stateConflict(): AppError {
  return new AppError('STATE_CONFLICT', '翻译状态已变更', 409);
}
