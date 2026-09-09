import { randomUUID } from 'node:crypto';

import {
  CreatedComputerUploadSessionSchema,
  ComputerUploadSessionDtoSchema,
  type ComputerUploadSessionDto,
  type CreatedComputerUploadSession,
} from '@context-reader/contracts';
import { and, eq } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  articleImports,
  computerUploadSessions,
  importAssets,
  jobs,
} from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { hashInstallationToken } from '../auth/token';
import {
  serializeArticleImport,
} from '../imports/serializer';
import { assertImportTransition } from '../imports/state';
import {
  capabilityMatches,
  createCapabilityToken,
  deriveUploadCode,
  hashCapabilityToken,
  hashUploadCode,
} from './code';

type SessionRow = typeof computerUploadSessions.$inferSelect;

export async function createComputerUploadSession(
  db: AppDatabase,
  input: {
    userId: string;
    installationToken: string;
    idempotencyKey: string;
    publicServerOrigin: string;
    ttlMs: number;
    draftTtlMs: number;
  },
): Promise<CreatedComputerUploadSession> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'create_computer_upload_session',
      input.idempotencyKey,
      { installationTokenHash: hashInstallationToken(input.installationToken) },
    );
    if (replay) {
      const session = await lockOwnedSession(tx, input.userId, replay);
      return serializeCreatedSession(input, session);
    }

    const sessionId = randomUUID();
    const importId = randomUUID();
    const code = deriveUploadCode(
      input.installationToken,
      input.userId,
      sessionId,
    );
    const now = new Date();
    const [createdImport] = await tx
      .insert(articleImports)
      .values({
        id: importId,
        userId: input.userId,
        sourceKind: 'computer',
        status: 'awaiting_upload',
        sourceUrl: null,
        assetManifestJson: null,
        expiresAt: new Date(now.getTime() + input.draftTtlMs),
      })
      .returning({ id: articleImports.id });
    if (!createdImport) {
      throw new AppError('INTERNAL_ERROR', '上传会话创建失败', 500, true);
    }
    const [session] = await tx
      .insert(computerUploadSessions)
      .values({
        id: sessionId,
        userId: input.userId,
        articleImportId: importId,
        codeHash: hashUploadCode(code),
        status: 'awaiting_code',
        expiresAt: new Date(now.getTime() + input.ttlMs),
      })
      .returning();
    if (!session) {
      throw new AppError('INTERNAL_ERROR', '上传会话创建失败', 500, true);
    }
    await finishIdempotentOperation(
      tx,
      input.userId,
      'create_computer_upload_session',
      input.idempotencyKey,
      sessionId,
    );
    return serializeCreatedSession(input, session, code);
  });
}

export async function claimComputerUploadSession(
  db: AppDatabase,
  input: { normalizedCode: string; now: Date },
): Promise<{ capabilityToken: string; expiresAt: Date }> {
  const codeHash = hashUploadCode(input.normalizedCode);
  const claimed = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(computerUploadSessions)
      .where(eq(computerUploadSessions.codeHash, codeHash))
      .limit(1)
      .for('update');
    if (!session) {
      throw new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
    }
    if (session.status === 'uploaded') {
      throw new AppError('UPLOAD_SESSION_USED', '上传码已被使用', 410);
    }
    if (session.status === 'expired') {
      throw new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
    }
    if (session.expiresAt.getTime() <= input.now.getTime()) {
      await expireClaimableSession(tx, session, input.now);
      return null;
    }
    if (session.status !== 'awaiting_code') {
      throw new AppError('UPLOAD_SESSION_USED', '上传码已被使用', 410);
    }
    const capability = createCapabilityToken();
    const [claimed] = await tx
      .update(computerUploadSessions)
      .set({
        status: 'claimed',
        capabilityTokenHash: capability.hash,
        claimedAt: input.now,
      })
      .where(
        and(
          eq(computerUploadSessions.id, session.id),
          eq(computerUploadSessions.status, 'awaiting_code'),
        ),
      )
      .returning({ id: computerUploadSessions.id });
    if (!claimed) {
      throw new AppError('UPLOAD_SESSION_USED', '上传码已被使用', 410);
    }
    return { capabilityToken: capability.raw, expiresAt: session.expiresAt };
  });
  if (!claimed) {
    throw new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
  }
  return claimed;
}

export async function consumeComputerUpload(
  db: AppDatabase,
  input: {
    capabilityToken: string;
    mediaType: string;
    content: Buffer;
    byteSize: number;
    sha256: string;
    jobDeadlineMs: number;
    now: Date;
  },
): Promise<{ importId: string }> {
  if (
    !/^[0-9a-f]{64}$/u.test(input.sha256) ||
    input.byteSize !== input.content.byteLength ||
    input.byteSize < 1
  ) {
    throw new AppError('IMPORT_CONTENT_INVALID', '上传内容无效', 422);
  }
  const consumed = await db.transaction(async (tx) => {
    const capabilityHash = hashCapabilityToken(input.capabilityToken);
    const [session] = await tx
      .select()
      .from(computerUploadSessions)
      .where(eq(computerUploadSessions.capabilityTokenHash, capabilityHash))
      .limit(1)
      .for('update');
    if (
      !session ||
      !session.capabilityTokenHash ||
      !capabilityMatches(input.capabilityToken, session.capabilityTokenHash)
    ) {
      throw new AppError('UPLOAD_SESSION_USED', '上传会话已被使用', 410);
    }
    if (session.status !== 'claimed') {
      throw new AppError('UPLOAD_SESSION_USED', '上传会话已被使用', 410);
    }
    if (session.expiresAt.getTime() <= input.now.getTime()) {
      await expireClaimableSession(tx, session, input.now);
      return null;
    }
    const [currentImport] = await tx
      .select()
      .from(articleImports)
      .where(eq(articleImports.id, session.articleImportId))
      .limit(1)
      .for('update');
    if (!currentImport || currentImport.status !== 'awaiting_upload') {
      throw new AppError('UPLOAD_SESSION_USED', '上传会话已被使用', 410);
    }
    assertImportTransition('awaiting_upload', 'queued', 'upload_complete');
    await tx.insert(importAssets).values({
      articleImportId: currentImport.id,
      position: 0,
      mediaType: input.mediaType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      content: input.content,
    });
    const [queued] = await tx
      .update(articleImports)
      .set({
        status: 'queued',
        updatedAt: input.now,
      })
      .where(eq(articleImports.id, currentImport.id))
      .returning({ id: articleImports.id });
    if (!queued) {
      throw new AppError('STATE_CONFLICT', '导入状态已变更', 409);
    }
    const [uploaded] = await tx
      .update(computerUploadSessions)
      .set({
        status: 'uploaded',
        capabilityTokenHash: null,
        uploadedAt: input.now,
      })
      .where(eq(computerUploadSessions.id, session.id))
      .returning({ id: computerUploadSessions.id });
    if (!uploaded) {
      throw new AppError('UPLOAD_SESSION_USED', '上传会话已被使用', 410);
    }
    await tx.insert(jobs).values({
      id: randomUUID(),
      kind: 'article_import',
      resourceId: currentImport.id,
      status: 'queued',
      attemptCount: 0,
      maxAttempts: 3,
      availableAt: input.now,
      deadlineAt: new Date(input.now.getTime() + input.jobDeadlineMs),
    });
    return { importId: currentImport.id };
  });
  if (!consumed) {
    throw new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
  }
  return consumed;
}

export async function getComputerUploadSessionForUser(
  db: AppDatabase,
  input: { userId: string; sessionId: string },
): Promise<ComputerUploadSessionDto> {
  const [row] = await db
    .select()
    .from(computerUploadSessions)
    .where(
      and(
        eq(computerUploadSessions.id, input.sessionId),
        eq(computerUploadSessions.userId, input.userId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError('NOT_FOUND', '上传会话不存在', 404);
  }
  let session = row;
  if (
    session.status !== 'uploaded' &&
    session.expiresAt.getTime() <= Date.now()
  ) {
    session = await expireSession(db, session);
  }
  const [importRow] = await db
    .select()
    .from(articleImports)
    .where(eq(articleImports.id, session.articleImportId))
    .limit(1);
  if (!importRow) {
    throw new AppError('NOT_FOUND', '上传会话不存在', 404);
  }
  return ComputerUploadSessionDtoSchema.parse({
    id: session.id,
    importId: session.articleImportId,
    status: session.status,
    expiresAt: session.expiresAt.toISOString(),
    articleImport: serializeArticleImport(importRow),
  });
}

async function expireSession(
  db: AppDatabase,
  session: SessionRow,
): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(computerUploadSessions)
      .where(eq(computerUploadSessions.id, session.id))
      .limit(1)
      .for('update');
    if (!locked) return session;
    if (
      locked.status === 'uploaded' ||
      locked.status === 'expired' ||
      locked.expiresAt.getTime() > Date.now()
    ) {
      return locked;
    }
    const [updated] = await tx
      .update(computerUploadSessions)
      .set({ status: 'expired', capabilityTokenHash: null })
      .where(
        and(
          eq(computerUploadSessions.id, locked.id),
          eq(computerUploadSessions.status, locked.status),
        ),
      )
    .returning();
    if (!updated) return locked;
    await expireLinkedImport(tx, locked.articleImportId, new Date());
    return updated;
  });
}

async function expireClaimableSession(
  tx: AppTransaction,
  session: SessionRow,
  now: Date,
): Promise<void> {
  await tx
    .update(computerUploadSessions)
    .set({ status: 'expired', capabilityTokenHash: null })
    .where(eq(computerUploadSessions.id, session.id));
  await expireLinkedImport(tx, session.articleImportId, now);
}

async function expireLinkedImport(
  tx: AppTransaction,
  importId: string,
  now: Date,
): Promise<void> {
  assertImportTransition('awaiting_upload', 'expired', 'expired');
  await tx
    .update(articleImports)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        eq(articleImports.id, importId),
        eq(articleImports.status, 'awaiting_upload'),
      ),
    );
  await tx
    .delete(importAssets)
    .where(eq(importAssets.articleImportId, importId));
}

async function lockOwnedSession(
  tx: AppTransaction,
  userId: string,
  sessionId: string,
): Promise<SessionRow> {
  const [session] = await tx
    .select()
    .from(computerUploadSessions)
    .where(
      and(
        eq(computerUploadSessions.id, sessionId),
        eq(computerUploadSessions.userId, userId),
      ),
    )
    .limit(1)
    .for('update');
  if (!session) {
    throw new AppError('INTERNAL_ERROR', '幂等请求状态无效', 500, true);
  }
  return session;
}

function serializeCreatedSession(
  input: { publicServerOrigin: string; installationToken: string; userId: string },
  session: SessionRow,
  code?: string,
): CreatedComputerUploadSession {
  const uploadCode =
    code ??
    deriveUploadCode(input.installationToken, input.userId, session.id);
  return CreatedComputerUploadSessionSchema.parse({
    sessionId: session.id,
    importId: session.articleImportId,
    uploadUrl: `${input.publicServerOrigin}/computer-upload`,
    uploadCode,
    expiresAt: session.expiresAt.toISOString(),
  });
}
