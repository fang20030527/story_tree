import {
  ArticleImportDtoSchema,
  ComputerUploadSessionDtoSchema,
  CreatedComputerUploadSessionSchema,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { hashInstallationToken } from '../auth/token';
import type { ApiEnv } from '../env';
import { handleImportReadRoute } from '../imports/read';
import { MAX_TEMP_STORAGE_BYTES } from '../imports/storage';
import {
  createCapabilityToken,
  deriveUploadCode,
  hashCapabilityToken,
  hashUploadCode,
} from './code';

const SESSION_TTL_MS = 600_000;
const DRAFT_TTL_MS = 604_800_000;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const JOB_DEADLINE_MS = 300_000;
const MAX_FILE_BYTES = 10_485_760;
const OPERATION = 'create_computer_upload_session';

interface SessionRow {
  id: string;
  user_id: string;
  article_import_id: string;
  code_hash: string;
  capability_token_hash: string | null;
  status: 'awaiting_code' | 'claimed' | 'uploaded' | 'expired';
  expires_at: string;
}

interface IdempotencyRow { request_hash: string; resource_id: string }
interface IdRow { id: string }
interface AssetRow { id: string; object_key: string }

function databaseUnavailable(): AppError {
  return new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
}

function used(): AppError {
  return new AppError('UPLOAD_SESSION_USED', '上传会话已被使用', 410);
}

function expired(): AppError {
  return new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
}

async function first<T>(env: ApiEnv, sql: string, ...parameters: unknown[]): Promise<T | null> {
  try {
    return await env.DB.prepare(sql).bind(...parameters).first<T>();
  } catch {
    throw databaseUnavailable();
  }
}

function resultRows<T>(result: unknown): T[] {
  if (!result || typeof result !== 'object' || !('results' in result)) return [];
  const rows = result.results;
  return Array.isArray(rows) ? rows as T[] : [];
}

async function digestText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function digestHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function findSession(env: ApiEnv, userId: string, sessionId: string): Promise<SessionRow | null> {
  return first<SessionRow>(env, `
    SELECT id, user_id, article_import_id, code_hash, capability_token_hash,
      status, expires_at
    FROM computer_upload_sessions WHERE id = ? AND user_id = ? LIMIT 1
  `, sessionId, userId);
}

async function expireSession(env: ApiEnv, sessionId: string, now: Date): Promise<void> {
  const timestamp = now.toISOString();
  try {
    // D1 batch is one transaction: the linked import expires only after this
    // session has become expired. R2 orphans are reconciled by the asset sweep.
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE computer_upload_sessions
        SET status = 'expired', capability_token_hash = NULL
        WHERE id = ? AND status IN ('awaiting_code', 'claimed') AND expires_at <= ?
      `).bind(sessionId, timestamp),
      env.DB.prepare(`
        UPDATE article_imports SET status = 'expired', updated_at = ?
        WHERE id = (SELECT article_import_id FROM computer_upload_sessions
                    WHERE id = ? AND status = 'expired')
          AND status = 'awaiting_upload'
      `).bind(timestamp, sessionId),
      env.DB.prepare(`
        DELETE FROM import_assets
        WHERE article_import_id = (SELECT article_import_id FROM computer_upload_sessions
                                   WHERE id = ? AND status = 'expired')
      `).bind(sessionId),
    ]);
  } catch {
    throw databaseUnavailable();
  }
}

function serializeCreated(
  session: SessionRow,
  installationToken: string,
  publicOrigin: string,
): Promise<ReturnType<typeof CreatedComputerUploadSessionSchema.parse>> {
  return deriveUploadCode(installationToken, session.user_id, session.id)
    .then((uploadCode) => CreatedComputerUploadSessionSchema.parse({
      sessionId: session.id,
      importId: session.article_import_id,
      uploadUrl: `${publicOrigin}/computer-upload`,
      uploadCode,
      expiresAt: new Date(session.expires_at).toISOString(),
    }));
}

export async function createComputerUploadSession(
  env: ApiEnv,
  input: {
    userId: string;
    installationToken: string;
    idempotencyKey: string;
    publicOrigin: string;
    allowNew: boolean;
  },
): Promise<ReturnType<typeof CreatedComputerUploadSessionSchema.parse>> {
  const tokenHash = await hashInstallationToken(input.installationToken);
  const requestHash = await digestText(JSON.stringify({ installationTokenHash: tokenHash }));
  const existing = await first<IdempotencyRow>(env, `
    SELECT request_hash, resource_id FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `, input.userId, OPERATION, input.idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
    }
    const session = await findSession(env, input.userId, existing.resource_id);
    if (!session) throw new AppError('INTERNAL_ERROR', '幂等请求状态无效', 500, true);
    return serializeCreated(session, input.installationToken, input.publicOrigin);
  }

  if (!input.allowNew) {
    throw new AppError('AI_UNAVAILABLE', '文章导入服务暂时不可用', 503, true);
  }

  const sessionId = crypto.randomUUID();
  const importId = crypto.randomUUID();
  const recordId = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const sessionExpiry = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const draftExpiry = new Date(now.getTime() + DRAFT_TTL_MS).toISOString();
  const recordExpiry = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  const code = await deriveUploadCode(input.installationToken, input.userId, sessionId);
  const codeHash = await hashUploadCode(code);

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO idempotency_records
          (id, user_id, operation, idempotency_key, request_hash,
            resource_type, resource_id, created_at, expires_at)
        SELECT ?, ?, ?, ?, ?, 'computer_upload_session', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL)
        ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
      `).bind(recordId, input.userId, OPERATION, input.idempotencyKey,
        requestHash, sessionId, nowIso, recordExpiry, input.userId),
      env.DB.prepare(`
        INSERT INTO article_imports
          (id, user_id, source_kind, status, source_url, asset_manifest_json,
            created_at, updated_at, expires_at)
        SELECT ?, ?, 'computer', 'awaiting_upload', NULL, NULL, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      `).bind(importId, input.userId, nowIso, nowIso, draftExpiry, recordId),
      env.DB.prepare(`
        INSERT INTO computer_upload_sessions
          (id, user_id, article_import_id, code_hash, status, expires_at, created_at)
        SELECT ?, ?, ?, ?, 'awaiting_code', ?, ?
        WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      `).bind(sessionId, input.userId, importId, codeHash, sessionExpiry, nowIso, recordId),
    ]);
  } catch {
    throw databaseUnavailable();
  }
  const saved = await first<IdempotencyRow>(env, `
    SELECT request_hash, resource_id FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `, input.userId, OPERATION, input.idempotencyKey);
  if (!saved) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  if (saved.request_hash !== requestHash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  const session = await findSession(env, input.userId, saved.resource_id);
  if (!session) throw new AppError('INTERNAL_ERROR', '上传会话创建失败', 500, true);
  return serializeCreated(session, input.installationToken, input.publicOrigin);
}

export async function getComputerUploadSessionForUser(
  request: Request,
  env: ApiEnv,
  userId: string,
  sessionId: string,
): Promise<ReturnType<typeof ComputerUploadSessionDtoSchema.parse>> {
  let session = await findSession(env, userId, sessionId);
  if (!session) throw new AppError('NOT_FOUND', '上传会话不存在', 404);
  if (session.status !== 'uploaded' && session.status !== 'expired' &&
      Date.parse(session.expires_at) <= Date.now()) {
    await expireSession(env, session.id, new Date());
    session = await findSession(env, userId, sessionId);
    if (!session) throw new AppError('NOT_FOUND', '上传会话不存在', 404);
  }
  const importRequest = new Request(new URL(`/v1/imports/${session.article_import_id}`, request.url));
  const response = await handleImportReadRoute(importRequest, env, userId);
  if (!response) throw new AppError('INTERNAL_ERROR', '上传会话暂时无法读取', 500, true);
  const articleImport = ArticleImportDtoSchema.parse(await response.json());
  return ComputerUploadSessionDtoSchema.parse({
    id: session.id,
    importId: session.article_import_id,
    status: session.status,
    expiresAt: new Date(session.expires_at).toISOString(),
    articleImport,
  });
}

export async function claimComputerUploadSession(
  env: ApiEnv,
  normalizedCode: string,
  now = new Date(),
): Promise<{ capabilityToken: string; expiresAt: Date }> {
  const codeHash = await hashUploadCode(normalizedCode);
  const capability = await createCapabilityToken();
  let claimed: IdRow & { expires_at: string } | null;
  try {
    claimed = await env.DB.prepare(`
      UPDATE computer_upload_sessions
      SET status = 'claimed', capability_token_hash = ?, claimed_at = ?
      WHERE code_hash = ? AND status = 'awaiting_code' AND expires_at > ?
        AND EXISTS (SELECT 1 FROM article_imports
                    WHERE id = article_import_id AND status = 'awaiting_upload')
      RETURNING id, expires_at
    `).bind(capability.hash, now.toISOString(), codeHash, now.toISOString())
      .first<IdRow & { expires_at: string }>();
  } catch {
    throw databaseUnavailable();
  }
  if (claimed) {
    return { capabilityToken: capability.raw, expiresAt: new Date(claimed.expires_at) };
  }
  const session = await first<SessionRow>(env, `
    SELECT id, user_id, article_import_id, code_hash, capability_token_hash,
      status, expires_at FROM computer_upload_sessions WHERE code_hash = ? LIMIT 1
  `, codeHash);
  if (session && session.status !== 'uploaded' && session.status !== 'expired' &&
      Date.parse(session.expires_at) <= now.getTime()) {
    await expireSession(env, session.id, now);
  }
  if (session?.status === 'claimed' || session?.status === 'uploaded') throw used();
  throw expired();
}

export async function assertUploadCapability(
  env: ApiEnv,
  capabilityToken: string,
  now = new Date(),
): Promise<SessionRow> {
  const capabilityHash = await hashCapabilityToken(capabilityToken);
  const session = await first<SessionRow>(env, `
    SELECT id, user_id, article_import_id, code_hash, capability_token_hash,
      status, expires_at
    FROM computer_upload_sessions WHERE capability_token_hash = ? LIMIT 1
  `, capabilityHash);
  if (!session || session.status !== 'claimed') throw used();
  if (Date.parse(session.expires_at) <= now.getTime()) {
    await expireSession(env, session.id, now);
    throw expired();
  }
  return session;
}

/** R2 writes precede the D1 transaction; a losing writer deletes only its own key. */
export async function consumeComputerUpload(
  env: ApiEnv,
  session: SessionRow,
  capabilityToken: string,
  content: Uint8Array,
  mediaType: string,
  now = new Date(),
): Promise<void> {
  if (content.byteLength < 1 || content.byteLength > MAX_FILE_BYTES) {
    throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
  }
  const usage = await env.DB.prepare(
    'SELECT COALESCE(SUM(byte_size), 0) AS total FROM import_assets',
  ).first<{ total: number }>();
  if (!usage || usage.total + content.byteLength > MAX_TEMP_STORAGE_BYTES) {
    throw new AppError('IMPORT_TOO_LARGE', '临时导入空间已满，请稍后重试', 413);
  }
  const capabilityHash = await hashCapabilityToken(capabilityToken);
  const checksum = await crypto.subtle.digest('SHA-256', new Uint8Array(content));
  const objectKey = `import-assets/${session.article_import_id}/0/${crypto.randomUUID()}`;
  const assetId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const nowIso = now.toISOString();
  const deadline = new Date(now.getTime() + JOB_DEADLINE_MS).toISOString();
  try {
    const stored = await env.IMPORT_BUCKET.put(objectKey, content, {
      sha256: checksum,
      httpMetadata: { contentType: mediaType },
    });
    if (!stored) throw databaseUnavailable();
  } catch {
    await env.IMPORT_BUCKET.delete(objectKey).catch(() => undefined);
    throw databaseUnavailable();
  }

  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO import_assets
          (id, article_import_id, position, media_type, byte_size, sha256, object_key,
            content, created_at)
        SELECT ?, s.article_import_id, 0, ?, ?, ?, ?, NULL, ?
        FROM computer_upload_sessions AS s
        JOIN article_imports AS i ON i.id = s.article_import_id
        WHERE s.id = ? AND s.capability_token_hash = ? AND s.status = 'claimed'
          AND s.expires_at > ? AND i.status = 'awaiting_upload' AND i.source_kind = 'computer'
          AND (SELECT COALESCE(SUM(byte_size), 0) FROM import_assets) + ? <= ?
        ON CONFLICT DO NOTHING
        RETURNING id
      `).bind(assetId, mediaType, content.byteLength, digestHex(checksum), objectKey,
        nowIso, session.id, capabilityHash, nowIso,
        content.byteLength, MAX_TEMP_STORAGE_BYTES),
      env.DB.prepare(`
        UPDATE article_imports SET status = 'queued', updated_at = ?
        WHERE id = ? AND status = 'awaiting_upload'
          AND EXISTS (SELECT 1 FROM import_assets WHERE id = ?)
        RETURNING id
      `).bind(nowIso, session.article_import_id, assetId),
      env.DB.prepare(`
        UPDATE computer_upload_sessions
        SET status = 'uploaded', capability_token_hash = NULL, uploaded_at = ?
        WHERE id = ? AND status = 'claimed' AND capability_token_hash = ?
          AND expires_at > ?
          AND EXISTS (SELECT 1 FROM import_assets WHERE id = ?)
          AND EXISTS (SELECT 1 FROM article_imports
                      WHERE id = article_import_id AND status = 'queued')
        RETURNING id
      `).bind(nowIso, session.id, capabilityHash, nowIso, assetId),
      env.DB.prepare(`
        INSERT INTO jobs
          (id, kind, resource_id, status, attempt_count, max_attempts,
            available_at, deadline_at, created_at)
        SELECT ?, 'article_import', ?, 'queued', 0, 3, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM computer_upload_sessions
                      WHERE id = ? AND status = 'uploaded' AND uploaded_at = ?)
          AND EXISTS (SELECT 1 FROM import_assets WHERE id = ?)
        RETURNING id
      `).bind(jobId, session.article_import_id, nowIso, deadline, nowIso,
        session.id, nowIso, assetId),
    ]);
    if (results.every((result) => resultRows<IdRow>(result).length === 1)) {
      // The cron dispatcher can recover a missed Queue delivery.
      await env.JOB_QUEUE?.send({ jobId }).catch(() => undefined);
      return;
    }
  } catch {
    // A D1 request may have committed before its response was lost. Inspect
    // the object key before deciding whether compensation is safe.
    const committed = await first<AssetRow>(env,
      'SELECT id, object_key FROM import_assets WHERE object_key = ? LIMIT 1', objectKey)
      .catch(() => undefined);
    if (committed === undefined) throw databaseUnavailable();
    if (committed) {
      const job = await first<IdRow>(env,
        "SELECT id FROM jobs WHERE kind = 'article_import' AND resource_id = ? LIMIT 1",
        session.article_import_id);
      if (job) return;
      throw databaseUnavailable();
    }
    await env.IMPORT_BUCKET.delete(objectKey).catch(() => undefined);
    throw databaseUnavailable();
  }

  await env.IMPORT_BUCKET.delete(objectKey).catch(() => undefined);
  const latest = await first<SessionRow>(env, `
    SELECT id, user_id, article_import_id, code_hash, capability_token_hash,
      status, expires_at FROM computer_upload_sessions WHERE id = ? LIMIT 1
  `, session.id);
  if (latest && Date.parse(latest.expires_at) <= now.getTime()) {
    await expireSession(env, session.id, now);
    throw expired();
  }
  throw used();
}
