import { createHash, randomUUID } from 'node:crypto';

import type {
  ArticleImportDto,
  ConfirmArticleImportRequest,
  CreateArticleImportRequest,
  UpdateImportPreviewRequest,
} from '@context-reader/contracts';
import { and, eq, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  articleImports,
  articleParagraphs,
  importedArticles,
  importAssets,
  jobs,
} from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import {
  normalizeImportContent,
  type NormalizedImportContent,
} from './content';
import {
  findDuplicateForUser,
  findOwnedImport,
  lockOwnedImport,
  type ArticleImportRow,
  type DuplicateMatch,
} from './repository';
import { serializeArticleImport } from './serializer';
import { assertImportTransition } from './state';

const CANCELLABLE_STATUSES = new Set([
  'awaiting_upload',
  'queued',
  'processing',
  'retryable',
  'preview_ready',
]);

export async function createArticleImport(
  db: AppDatabase,
  input: {
    userId: string;
    idempotencyKey: string;
    request: CreateArticleImportRequest;
    draftTtlMs: number;
    jobDeadlineMs: number;
  },
): Promise<ArticleImportDto> {
  const sourceUrl = validateSourceUrl(input.request);
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'create_article_import',
      input.idempotencyKey,
      input.request,
    );
    if (replay) {
      return serializeOwnedImport(tx, input.userId, replay);
    }

    const importId = randomUUID();
    const queued = input.request.sourceKind === 'url';
    const [created] = await tx
      .insert(articleImports)
      .values({
        id: importId,
        userId: input.userId,
        sourceKind: input.request.sourceKind,
        status: queued ? 'queued' : 'awaiting_upload',
        sourceUrl,
        assetManifestJson:
          input.request.sourceKind === 'album' ||
          input.request.sourceKind === 'local_file'
            ? input.request.assets.map((asset) => ({ ...asset }))
            : null,
        expiresAt: new Date(Date.now() + input.draftTtlMs),
      })
      .returning();
    if (!created) {
      throw new AppError('INTERNAL_ERROR', '导入任务创建失败', 500, true);
    }

    if (queued) {
      await createImportJob(tx, importId, input.jobDeadlineMs);
    }
    await finishIdempotentOperation(
      tx,
      input.userId,
      'create_article_import',
      input.idempotencyKey,
      importId,
    );
    return serializeArticleImport(created);
  });
}

export async function putPastedSource(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    content: Buffer;
  },
): Promise<ArticleImportDto> {
  const text = decodePastedText(input.content);
  const normalized = normalizeImportContent({ title: null, text });
  const sourceDigest = createHash('sha256').update(input.content).digest('hex');

  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'upload_import_text',
      input.idempotencyKey,
      { importId: input.importId, sourceDigest },
    );
    if (replay) {
      return serializeOwnedImport(tx, input.userId, replay);
    }

    const current = await lockOwnedImport(tx, input.userId, input.importId);
    if (current.sourceKind !== 'paste' || current.status !== 'awaiting_upload') {
      throw new AppError('STATE_CONFLICT', '当前导入状态不能接收正文', 409);
    }
    const updated = await persistPreview(tx, current.id, normalized);
    await finishIdempotentOperation(
      tx,
      input.userId,
      'upload_import_text',
      input.idempotencyKey,
      current.id,
    );
    return serializeWithDuplicate(tx, input.userId, updated);
  });
}

export async function getArticleImportForUser(
  db: AppDatabase,
  input: { userId: string; importId: string },
): Promise<ArticleImportDto> {
  const row = await findOwnedImport(db, input.userId, input.importId);
  return serializeWithDuplicate(db, input.userId, row);
}

export async function updateImportPreview(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    request: UpdateImportPreviewRequest;
  },
): Promise<ArticleImportDto> {
  const normalized = normalizeImportContent(input.request);
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'edit_import_preview',
      input.idempotencyKey,
      { importId: input.importId, ...input.request },
    );
    if (replay) {
      return serializeOwnedImport(tx, input.userId, replay);
    }

    const current = await lockOwnedImport(tx, input.userId, input.importId);
    if (current.status !== 'preview_ready') {
      throw new AppError('STATE_CONFLICT', '当前导入状态不能编辑预览', 409);
    }
    const updated = await persistPreview(tx, current.id, normalized);
    await finishIdempotentOperation(
      tx,
      input.userId,
      'edit_import_preview',
      input.idempotencyKey,
      current.id,
    );
    return serializeWithDuplicate(tx, input.userId, updated);
  });
}

export async function confirmArticleImport(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    request: ConfirmArticleImportRequest;
  },
): Promise<ArticleImportDto> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'confirm_article_import',
      input.idempotencyKey,
      { importId: input.importId, ...input.request },
    );
    if (replay) {
      return serializeOwnedImport(tx, input.userId, replay);
    }

    const current = await lockOwnedImport(tx, input.userId, input.importId);
    if (current.status !== 'preview_ready') {
      throw new AppError('STATE_CONFLICT', '当前导入状态不能确认', 409);
    }
    const content = normalizeStoredPreview(current);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${input.userId}:${content.contentHash}`}))`,
    );
    const duplicate = await findDuplicateForUser(tx, input.userId, {
      contentHash: content.contentHash,
      fingerprint: content.similarityFingerprint,
      wordCount: content.wordCount,
    });
    const articleId = await resolveConfirmationArticle(tx, {
      userId: input.userId,
      current,
      content,
      duplicate,
      decision: input.request.similarityDecision,
    });

    assertImportTransition(current.status, 'confirmed', 'confirmed');
    const now = new Date();
    const [confirmed] = await tx
      .update(articleImports)
      .set({
        status: 'confirmed',
        articleId,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(articleImports.id, current.id),
          eq(articleImports.userId, input.userId),
        ),
      )
      .returning();
    if (!confirmed) {
      throw new AppError('NOT_FOUND', '导入任务不存在', 404);
    }
    await tx
      .delete(importAssets)
      .where(eq(importAssets.articleImportId, current.id));
    await finishIdempotentOperation(
      tx,
      input.userId,
      'confirm_article_import',
      input.idempotencyKey,
      current.id,
    );
    return serializeArticleImport(confirmed);
  });
}

export async function cancelArticleImport(
  db: AppDatabase,
  input: { userId: string; importId: string; idempotencyKey: string },
): Promise<ArticleImportDto> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'cancel_article_import',
      input.idempotencyKey,
      { importId: input.importId },
    );
    if (replay) {
      return serializeOwnedImport(tx, input.userId, replay);
    }

    const current = await lockOwnedImport(tx, input.userId, input.importId);
    if (!CANCELLABLE_STATUSES.has(current.status)) {
      throw new AppError('STATE_CONFLICT', '当前导入状态不能取消', 409);
    }
    assertImportTransition(current.status, 'cancelled', 'cancelled');
    const [cancelled] = await tx
      .update(articleImports)
      .set({
        status: 'cancelled',
        previewTitle: null,
        previewText: null,
        wordCount: null,
        contentHash: null,
        similarityFingerprint: null,
        failureCode: null,
        failureMessagePublic: null,
        processingStartedAt: null,
        previewReadyAt: null,
        articleId: null,
        confirmedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(articleImports.id, current.id),
          eq(articleImports.userId, input.userId),
        ),
      )
      .returning();
    if (!cancelled) {
      throw new AppError('NOT_FOUND', '导入任务不存在', 404);
    }
    await tx
      .delete(importAssets)
      .where(eq(importAssets.articleImportId, current.id));
    await finishIdempotentOperation(
      tx,
      input.userId,
      'cancel_article_import',
      input.idempotencyKey,
      current.id,
    );
    return serializeArticleImport(cancelled);
  });
}

export async function retryArticleImport(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    jobDeadlineMs: number;
    assetTtlMs: number;
  },
): Promise<ArticleImportDto> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'retry_article_import',
      input.idempotencyKey,
      { importId: input.importId },
    );
    if (replay) {
      return serializeOwnedImport(tx, input.userId, replay);
    }

    const current = await lockOwnedImport(tx, input.userId, input.importId);
    if (current.status !== 'retryable') {
      throw new AppError('STATE_CONFLICT', '当前导入状态不能重试', 409);
    }
    const now = new Date();
    if (current.expiresAt.getTime() <= now.getTime()) {
      throw new AppError('STATE_CONFLICT', '导入内容已过期', 409);
    }
    const assets = await tx
      .select({ createdAt: importAssets.createdAt })
      .from(importAssets)
      .where(eq(importAssets.articleImportId, current.id));
    if (
      assets.some(
        ({ createdAt }) =>
          createdAt.getTime() + input.assetTtlMs <= now.getTime(),
      )
    ) {
      throw new AppError('STATE_CONFLICT', '导入源文件已过期', 409);
    }
    const [activeJob] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, 'article_import'),
          eq(jobs.resourceId, current.id),
          sql`${jobs.status} in ('queued', 'running')`,
        ),
      )
      .limit(1);
    if (activeJob) {
      throw new AppError('STATE_CONFLICT', '导入任务正在处理', 409, true);
    }

    assertImportTransition('retryable', 'queued', 'user_retry');
    const [queued] = await tx
      .update(articleImports)
      .set({
        status: 'queued',
        failureCode: null,
        failureMessagePublic: null,
        processingStartedAt: null,
        updatedAt: now,
      })
      .where(eq(articleImports.id, current.id))
      .returning();
    if (!queued) {
      throw new AppError('NOT_FOUND', '导入任务不存在', 404);
    }
    await createImportJob(tx, current.id, input.jobDeadlineMs);
    await finishIdempotentOperation(
      tx,
      input.userId,
      'retry_article_import',
      input.idempotencyKey,
      current.id,
    );
    return serializeArticleImport(queued);
  });
}

function validateSourceUrl(request: CreateArticleImportRequest): string | null {
  if (request.sourceKind !== 'url') {
    return null;
  }
  const url = new URL(request.url);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new AppError(
      'IMPORT_FETCH_BLOCKED',
      '该网络地址不允许导入',
      422,
    );
  }
  url.hash = '';
  return url.toString();
}

function decodePastedText(content: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new AppError('IMPORT_CONTENT_INVALID', '正文不是有效的 UTF-8 文本', 422);
  }
}

async function createImportJob(
  tx: AppTransaction,
  importId: string,
  deadlineMs: number,
): Promise<void> {
  await tx.insert(jobs).values({
    id: randomUUID(),
    kind: 'article_import',
    resourceId: importId,
    status: 'queued',
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: new Date(),
    deadlineAt: new Date(Date.now() + deadlineMs),
  });
}

async function persistPreview(
  tx: AppTransaction,
  importId: string,
  normalized: NormalizedImportContent,
): Promise<ArticleImportRow> {
  const now = new Date();
  const [updated] = await tx
    .update(articleImports)
    .set({
      status: 'preview_ready',
      previewTitle: normalized.title,
      previewText: normalized.text,
      wordCount: normalized.wordCount,
      contentHash: normalized.contentHash,
      similarityFingerprint: normalized.similarityFingerprint,
      failureCode: null,
      failureMessagePublic: null,
      previewReadyAt: now,
      updatedAt: now,
    })
    .where(eq(articleImports.id, importId))
    .returning();
  if (!updated) {
    throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  }
  return updated;
}

async function serializeOwnedImport(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  importId: string,
): Promise<ArticleImportDto> {
  const row = await findOwnedImport(db, userId, importId);
  return serializeWithDuplicate(db, userId, row);
}

async function serializeWithDuplicate(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  row: ArticleImportRow,
): Promise<ArticleImportDto> {
  const duplicate =
    row.status === 'preview_ready'
      ? await findDuplicateForUser(db, userId, previewIdentity(row))
      : { kind: 'none' as const };
  return serializeArticleImport(row, duplicate);
}

function previewIdentity(row: ArticleImportRow) {
  if (
    row.contentHash === null ||
    row.similarityFingerprint === null ||
    row.wordCount === null
  ) {
    throw new AppError('INTERNAL_ERROR', '导入预览暂时无法读取', 500, true);
  }
  return {
    contentHash: row.contentHash,
    fingerprint: row.similarityFingerprint,
    wordCount: row.wordCount,
  };
}

function normalizeStoredPreview(row: ArticleImportRow): NormalizedImportContent {
  if (row.previewTitle === null || row.previewText === null) {
    throw new AppError('INTERNAL_ERROR', '导入预览暂时无法读取', 500, true);
  }
  return normalizeImportContent({
    title: row.previewTitle,
    text: row.previewText,
  });
}

async function resolveConfirmationArticle(
  tx: AppTransaction,
  input: {
    userId: string;
    current: ArticleImportRow;
    content: NormalizedImportContent;
    duplicate: DuplicateMatch;
    decision: 'open_existing' | 'save_new_version' | undefined;
  },
): Promise<string> {
  if (input.duplicate.kind === 'exact') {
    return input.duplicate.article.id;
  }
  if (input.duplicate.kind === 'similar') {
    if (!input.decision) {
      throw new AppError(
        'SIMILAR_ARTICLE_REQUIRES_DECISION',
        '发现相似文章，请选择打开已有文章或保存新版本',
        409,
      );
    }
    if (input.decision === 'open_existing') {
      return input.duplicate.article.id;
    }
    return createArticleWithUniqueRaceRecovery(tx, {
      ...input,
      previousVersionId: input.duplicate.article.id,
    });
  }
  if (input.decision !== undefined) {
    throw new AppError('VALIDATION_ERROR', '当前没有需要处理的相似文章', 400);
  }
  return createArticleWithUniqueRaceRecovery(tx, {
    ...input,
    previousVersionId: null,
  });
}

async function createArticleWithUniqueRaceRecovery(
  tx: AppTransaction,
  input: {
    userId: string;
    current: ArticleImportRow;
    content: NormalizedImportContent;
    previousVersionId: string | null;
  },
): Promise<string> {
  try {
    return await tx.transaction((savepoint) => createArticle(savepoint, input));
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const duplicate = await findDuplicateForUser(tx, input.userId, {
      contentHash: input.content.contentHash,
      fingerprint: input.content.similarityFingerprint,
      wordCount: input.content.wordCount,
    });
    if (duplicate.kind !== 'exact') {
      throw error;
    }
    return duplicate.article.id;
  }
}

async function createArticle(
  tx: AppTransaction,
  input: {
    userId: string;
    current: ArticleImportRow;
    content: NormalizedImportContent;
    previousVersionId: string | null;
  },
): Promise<string> {
  const articleId = randomUUID();
  await tx.insert(importedArticles).values({
    id: articleId,
    userId: input.userId,
    sourceKind: input.current.sourceKind,
    sourceUrl: input.current.sourceUrl,
    title: input.content.title,
    wordCount: input.content.wordCount,
    contentHash: input.content.contentHash,
    similarityFingerprint: input.content.similarityFingerprint,
    previousVersionId: input.previousVersionId,
    importedAt: new Date(),
  });
  await tx.insert(articleParagraphs).values(
    input.content.paragraphs.map((plainText, position) => ({
      id: randomUUID(),
      articleId,
      position,
      plainText,
    })),
  );
  return articleId;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
