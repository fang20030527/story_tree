import type { ApiEnv } from '../env';

const OBJECT_PREFIX = 'import-assets/';
const MAX_ASSET_BYTES = 10_485_760;
const MAX_TOTAL_BYTES = 31_457_280;
// 2026 audio already occupies 8.38 GB of the account-shared 10 GB-month R2
// allowance. Keep temporary imports well below the remaining space.
export const MAX_TEMP_STORAGE_BYTES = 268_435_456;
const DEFAULT_SWEEP_BATCH = 100;
const MEDIA_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
  'application/xhtml+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/octet-stream',
]);

interface AssetRow extends Record<string, unknown> {
  id: string;
  article_import_id: string;
  position: number;
  media_type: string;
  byte_size: number;
  sha256: string;
  object_key: string;
  created_at: string;
}

interface ImportRow extends Record<string, unknown> {
  status: string;
  asset_manifest_json: string | null;
}

interface R2AssetBucket {
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size?: number } | null>;
  put(
    key: string,
    value: Uint8Array,
    options: { sha256: ArrayBuffer; httpMetadata: { contentType: string } },
  ): Promise<{ size?: number } | null>;
  delete(key: string | string[]): Promise<void>;
  list(options: {
    prefix: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    objects: Array<{ key: string; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface StoredImportAsset {
  articleImportId: string;
  position: number;
  mediaType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

export interface ImportAssetContent extends StoredImportAsset {
  content: Uint8Array;
}

export interface PutImportAssetInput {
  articleImportId: string;
  position: number;
  mediaType: string;
  bytes: Uint8Array;
  /** Optional wire Content-Length. The manifest size is always checked. */
  declaredByteSize?: number;
  /** Optional client digest; the server always computes its own SHA-256. */
  declaredSha256?: string;
}

export class ImportStorageError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_ERROR'
      | 'IMPORT_UNSUPPORTED_TYPE'
      | 'IMPORT_TOO_LARGE'
      | 'STATE_CONFLICT'
      | 'IMPORT_CONTENT_INVALID'
      | 'DATABASE_UNAVAILABLE',
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ImportStorageError';
  }
}

/**
 * Store private bytes in R2, then atomically register their D1 metadata.
 * Each attempt gets a fresh key, so compensating a losing concurrent upload
 * cannot delete another request's object.
 */
export async function putImportAsset(
  env: ApiEnv,
  input: PutImportAssetInput,
): Promise<StoredImportAsset> {
  assertImportId(input.articleImportId);
  assertPosition(input.position);
  assertSize(input.bytes);
  const mediaType = normalizeMediaType(input.mediaType);
  if (input.declaredByteSize !== undefined && input.declaredByteSize !== input.bytes.byteLength) {
    throw conflict('上传文件大小与导入清单不一致');
  }
  const checksum = await crypto.subtle.digest('SHA-256', new Uint8Array(input.bytes));
  const sha256 = hexDigest(checksum);
  if (
    input.declaredSha256 !== undefined &&
    (!/^[0-9a-f]{64}$/u.test(input.declaredSha256) ||
      input.declaredSha256 !== sha256)
  ) {
    throw conflict('上传文件校验值不一致');
  }

  const existing = await assertUploadAllowed(env, {
    articleImportId: input.articleImportId,
    position: input.position,
    mediaType,
    byteSize: input.bytes.byteLength,
    sha256,
  });
  if (existing) {
    try {
      await readObjectForRow(env, existing);
      return toPublicAsset(existing);
    } catch (error) {
      if (!(error instanceof ImportStorageError) || error.code !== 'IMPORT_CONTENT_INVALID') {
        throw error;
      }
      // A retry can repair a row whose R2 object was lost after a partial delete.
    }
  }

  const objectKey = `${OBJECT_PREFIX}${input.articleImportId}/${input.position}/${crypto.randomUUID()}`;
  const bucket = assetBucket(env);
  try {
    const stored = await bucket.put(objectKey, input.bytes, {
      sha256: checksum,
      httpMetadata: { contentType: mediaType },
    });
    if (!stored || (stored.size !== undefined && stored.size !== input.bytes.byteLength)) {
      throw storageUnavailable();
    }
  } catch {
    // R2 can have completed a write just before an uncertain failure.
    await compensateObject(env, objectKey);
    throw storageUnavailable();
  }

  try {
    const written = existing
      ? await repairAssetRow(env, existing, objectKey)
      : await insertAssetRow(env, {
          articleImportId: input.articleImportId,
          position: input.position,
          mediaType,
          byteSize: input.bytes.byteLength,
          sha256,
          objectKey,
        });
    if (written) {
      if (existing) await compensateObject(env, existing.object_key);
      return toPublicAsset(written);
    }
  } catch {
    // A D1 timeout may arrive after the INSERT or UPDATE committed. Never
    // delete a key that D1 might already reference.
    const committed = await findAssetByObjectKeyIfAvailable(env, objectKey);
    if (committed) {
      if (existing) await compensateObject(env, existing.object_key);
      return toPublicAsset(committed);
    }
    if (committed === null) await compensateObject(env, objectKey);
    throw storageUnavailable();
  }

  await compensateObject(env, objectKey);
  // A concurrent identical PUT is a safe replay; all other outcomes conflict.
  const winner = await assertUploadAllowed(env, {
    articleImportId: input.articleImportId,
    position: input.position,
    mediaType,
    byteSize: input.bytes.byteLength,
    sha256,
  });
  if (winner) {
    await readObjectForRow(env, winner);
    return toPublicAsset(winner);
  }
  throw conflict('导入状态已变更');
}

export async function getImportAssetMetadata(
  env: ApiEnv,
  articleImportId: string,
  position: number,
): Promise<StoredImportAsset | null> {
  const row = await findAssetRow(env, articleImportId, position);
  return row ? toPublicAsset(row) : null;
}

export async function listImportAssetMetadata(
  env: ApiEnv,
  articleImportId: string,
): Promise<StoredImportAsset[]> {
  assertImportId(articleImportId);
  try {
    const rows = await env.DB.prepare(
      'SELECT * FROM import_assets WHERE article_import_id = ? ORDER BY position',
    )
      .bind(articleImportId)
      .all<AssetRow>();
    return rows.results.map(toPublicAsset);
  } catch {
    throw storageUnavailable();
  }
}

/** Read and verify both the R2 byte count and SHA-256 against D1 metadata. */
export async function getImportAsset(
  env: ApiEnv,
  articleImportId: string,
  position: number,
): Promise<ImportAssetContent> {
  const row = await findAssetRow(env, articleImportId, position);
  if (!row) throw invalidContent();
  const content = await readObjectForRow(env, row);
  return { ...toPublicAsset(row), content };
}

/** Delete R2 first; if D1 then fails, the retained row makes retry possible. */
export async function deleteImportAsset(
  env: ApiEnv,
  articleImportId: string,
  position: number,
): Promise<boolean> {
  const row = await findAssetRow(env, articleImportId, position);
  if (!row) return false;
  await deleteRowObject(env, row);
  return true;
}

/**
 * Purge a terminal import's whole R2 prefix, including orphan writes from
 * failed D1 inserts, then remove its remaining D1 rows. Safe to retry.
 */
export async function purgeImportAssetsForImport(
  env: ApiEnv,
  articleImportId: string,
): Promise<number> {
  assertImportId(articleImportId);
  const current = await readImportRow(env, articleImportId);
  if (
    current &&
    !['confirmed', 'failed', 'expired', 'cancelled'].includes(current.status)
  ) {
    throw conflict('当前导入状态不能清理文件');
  }
  const prefix = `${OBJECT_PREFIX}${articleImportId}/`;
  const bucket = assetBucket(env);
  // Remove the first page repeatedly: deleting while following cursors can skip keys.
  for (let page = 0; page < 100; page += 1) {
    let listed: Awaited<ReturnType<R2AssetBucket['list']>>;
    try {
      listed = await bucket.list({ prefix, limit: 1_000 });
      if (listed.objects.length > 0) {
        await bucket.delete(listed.objects.map(({ key }) => key));
      }
    } catch {
      throw storageUnavailable();
    }
    if (listed.objects.length === 0 && !listed.truncated) break;
    if (page === 99) throw storageUnavailable();
  }
  try {
    const result = await env.DB.prepare(
      'DELETE FROM import_assets WHERE article_import_id = ?',
    )
      .bind(articleImportId)
      .run();
    return changes(result);
  } catch {
    throw storageUnavailable();
  }
}

/** Expire stale partial uploads and clear terminal or expired imports. */
export async function sweepExpiredImportAssets(
  env: ApiEnv,
  input: { now: Date; assetTtlMs: number; batchSize?: number },
): Promise<{ deleted: number; failed: number }> {
  if (
    !Number.isFinite(input.now.getTime()) ||
    !Number.isSafeInteger(input.assetTtlMs) ||
    input.assetTtlMs <= 0
  ) {
    throw new RangeError('Invalid asset cleanup deadline');
  }
  const limit = boundedBatchSize(input.batchSize);
  const cutoff = new Date(input.now.getTime() - input.assetTtlMs).toISOString();
  const now = input.now.toISOString();
  let rows: AssetRow[];
  try {
    const found = await env.DB.prepare(
      `SELECT a.* FROM import_assets AS a
       LEFT JOIN article_imports AS i ON i.id = a.article_import_id
       WHERE i.status IN ('confirmed', 'failed', 'expired', 'cancelled')
          OR (i.status = 'awaiting_upload' AND a.created_at <= ?)
          OR (i.status IN ('awaiting_upload', 'retryable', 'preview_ready')
              AND i.expires_at <= ?)
       ORDER BY a.created_at, a.id LIMIT ?`,
    )
      .bind(cutoff, now, limit)
      .all<AssetRow>();
    rows = found.results;
  } catch {
    throw storageUnavailable();
  }
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await deleteRowObject(env, row);
      deleted += 1;
    } catch {
      failed += 1; // D1 retains the row for the next sweep.
    }
  }
  return { deleted, failed };
}

/** Reconcile R2 objects left behind by failed compensation or D1 cascades. */
export async function sweepOrphanedImportObjects(
  env: ApiEnv,
  input: { now: Date; cursor?: string; batchSize?: number },
): Promise<{ deleted: number; nextCursor: string | null }> {
  if (!Number.isFinite(input.now.getTime())) {
    throw new RangeError('Invalid orphan cleanup time');
  }
  const limit = boundedBatchSize(input.batchSize);
  const bucket = assetBucket(env);
  let page: Awaited<ReturnType<R2AssetBucket['list']>>;
  try {
    page = await bucket.list({
      prefix: OBJECT_PREFIX,
      limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
  } catch {
    throw storageUnavailable();
  }
  // Avoid racing a still-running PUT followed by its D1 insert.
  const cutoff = input.now.getTime() - 60 * 60 * 1_000;
  const candidates = page.objects.filter(
    (object) =>
      object.key.startsWith(OBJECT_PREFIX) &&
      object.uploaded.getTime() <= cutoff,
  );
  if (candidates.length === 0) {
    return { deleted: 0, nextCursor: page.truncated ? page.cursor ?? null : null };
  }
  const keys = candidates.map(({ key }) => key);
  const placeholders = keys.map(() => '?').join(',');
  let live: Set<string>;
  try {
    const rows = await env.DB.prepare(
      `SELECT object_key FROM import_assets WHERE object_key IN (${placeholders})`,
    )
      .bind(...keys)
      .all<{ object_key: string }>();
    live = new Set(rows.results.map(({ object_key }) => object_key));
  } catch {
    throw storageUnavailable();
  }
  const stale = keys.filter((key) => !live.has(key));
  if (stale.length > 0) {
    try {
      await bucket.delete(stale);
    } catch {
      throw storageUnavailable();
    }
  }
  return {
    deleted: stale.length,
    nextCursor: page.truncated ? page.cursor ?? null : null,
  };
}

async function assertUploadAllowed(
  env: ApiEnv,
  input: {
    articleImportId: string;
    position: number;
    mediaType: string;
    byteSize: number;
    sha256: string;
  },
): Promise<AssetRow | null> {
  const current = await readImportRow(env, input.articleImportId);
  if (!current || current.status !== 'awaiting_upload') {
    throw conflict('当前导入状态不能上传文件');
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(current.asset_manifest_json ?? 'null');
  } catch {
    throw conflict('导入清单无效');
  }
  const expected = Array.isArray(manifest)
    ? manifest.find((entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'position' in entry &&
        entry.position === input.position,
      )
    : undefined;
  if (
    !expected ||
    expected.mediaType !== input.mediaType ||
    expected.byteSize !== input.byteSize
  ) {
    throw conflict('上传文件与导入清单不一致');
  }
  let rows: AssetRow[];
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM import_assets WHERE article_import_id = ? ORDER BY position',
    )
      .bind(input.articleImportId)
      .all<AssetRow>();
    rows = result.results;
  } catch {
    throw storageUnavailable();
  }
  const existing = rows.find((row) => row.position === input.position);
  if (existing) {
    if (
      existing.media_type === input.mediaType &&
      existing.byte_size === input.byteSize &&
      existing.sha256 === input.sha256
    ) {
      return existing;
    }
    throw conflict('该文件位置已被占用');
  }
  if (rows.some((row) => row.sha256 === input.sha256)) {
    throw conflict('相同文件不能重复上传');
  }
  if (rows.reduce((sum, row) => sum + row.byte_size, 0) + input.byteSize > MAX_TOTAL_BYTES) {
    throw tooLarge('上传文件总大小过大');
  }
  const usage = await env.DB.prepare(
    'SELECT COALESCE(SUM(byte_size), 0) AS total FROM import_assets',
  ).first<{ total: number }>();
  if (!usage || usage.total + input.byteSize > MAX_TEMP_STORAGE_BYTES) {
    throw tooLarge('临时导入空间已满，请稍后重试');
  }
  return null;
}

async function insertAssetRow(
  env: ApiEnv,
  input: {
    articleImportId: string;
    position: number;
    mediaType: string;
    byteSize: number;
    sha256: string;
    objectKey: string;
  },
): Promise<AssetRow | null> {
  // The conditions belong in the INSERT, not just the preflight SELECT, so
  // concurrent uploads cannot bypass the manifest, status, or total-size cap.
  return env.DB.prepare(
    `INSERT INTO import_assets
       (id, article_import_id, position, media_type, byte_size, sha256, object_key, content)
     SELECT ?, ?, ?, ?, ?, ?, ?, NULL
     WHERE EXISTS (
       SELECT 1 FROM article_imports AS i, json_each(i.asset_manifest_json) AS expected
       WHERE i.id = ? AND i.status = 'awaiting_upload'
         AND json_extract(expected.value, '$.position') = ?
         AND json_extract(expected.value, '$.mediaType') = ?
         AND json_extract(expected.value, '$.byteSize') = ?
     )
       AND (SELECT COALESCE(SUM(byte_size), 0) FROM import_assets
            WHERE article_import_id = ?) + ? <= ?
       AND (SELECT COALESCE(SUM(byte_size), 0) FROM import_assets) + ? <= ?
       AND NOT EXISTS (SELECT 1 FROM import_assets
                       WHERE article_import_id = ? AND position = ?)
       AND NOT EXISTS (SELECT 1 FROM import_assets
                       WHERE article_import_id = ? AND sha256 = ?)
     RETURNING *`,
  )
    .bind(
      crypto.randomUUID(),
      input.articleImportId,
      input.position,
      input.mediaType,
      input.byteSize,
      input.sha256,
      input.objectKey,
      input.articleImportId,
      input.position,
      input.mediaType,
      input.byteSize,
      input.articleImportId,
      input.byteSize,
      MAX_TOTAL_BYTES,
      input.byteSize,
      MAX_TEMP_STORAGE_BYTES,
      input.articleImportId,
      input.position,
      input.articleImportId,
      input.sha256,
    )
    .first<AssetRow>();
}

async function repairAssetRow(
  env: ApiEnv,
  row: AssetRow,
  objectKey: string,
): Promise<AssetRow | null> {
  return env.DB.prepare(
    `UPDATE import_assets SET object_key = ?
     WHERE id = ? AND object_key = ?
       AND EXISTS (SELECT 1 FROM article_imports
                   WHERE id = ? AND status = 'awaiting_upload')
     RETURNING *`,
  )
    .bind(objectKey, row.id, row.object_key, row.article_import_id)
    .first<AssetRow>();
}

async function readImportRow(env: ApiEnv, articleImportId: string): Promise<ImportRow | null> {
  try {
    return await env.DB.prepare(
      'SELECT status, asset_manifest_json FROM article_imports WHERE id = ? LIMIT 1',
    )
      .bind(articleImportId)
      .first<ImportRow>();
  } catch {
    throw storageUnavailable();
  }
}

async function findAssetByObjectKeyIfAvailable(
  env: ApiEnv,
  objectKey: string,
): Promise<AssetRow | null | undefined> {
  try {
    return await env.DB.prepare(
      'SELECT * FROM import_assets WHERE object_key = ? LIMIT 1',
    )
      .bind(objectKey)
      .first<AssetRow>();
  } catch {
    return undefined; // Keep the R2 object until orphan reconciliation.
  }
}

async function findAssetRow(
  env: ApiEnv,
  articleImportId: string,
  position: number,
): Promise<AssetRow | null> {
  assertImportId(articleImportId);
  assertPosition(position);
  try {
    return await env.DB.prepare(
      'SELECT * FROM import_assets WHERE article_import_id = ? AND position = ? LIMIT 1',
    )
      .bind(articleImportId, position)
      .first<AssetRow>();
  } catch {
    throw storageUnavailable();
  }
}

async function readObjectForRow(env: ApiEnv, row: AssetRow): Promise<Uint8Array> {
  assertObjectKey(row);
  if (
    !Number.isSafeInteger(row.byte_size) ||
    row.byte_size < 1 ||
    row.byte_size > MAX_ASSET_BYTES ||
    !/^[0-9a-f]{64}$/u.test(row.sha256)
  ) {
    throw invalidContent();
  }
  let object: Awaited<ReturnType<R2AssetBucket['get']>>;
  try {
    object = await assetBucket(env).get(row.object_key);
  } catch {
    throw storageUnavailable();
  }
  if (!object || (object.size !== undefined && object.size !== row.byte_size)) {
    throw invalidContent();
  }
  let content: Uint8Array;
  try {
    content = await readBounded(object.body, row.byte_size);
  } catch (error) {
    if (error instanceof ImportStorageError) throw error;
    throw storageUnavailable();
  }
  if (content.byteLength !== row.byte_size) throw invalidContent();
  const digest = hexDigest(await crypto.subtle.digest('SHA-256', new Uint8Array(content)));
  if (digest !== row.sha256) throw invalidContent();
  return content;
}

async function deleteRowObject(env: ApiEnv, row: AssetRow): Promise<void> {
  assertObjectKey(row);
  try {
    await assetBucket(env).delete(row.object_key);
  } catch {
    throw storageUnavailable();
  }
  try {
    await env.DB.prepare(
      'DELETE FROM import_assets WHERE id = ? AND object_key = ?',
    )
      .bind(row.id, row.object_key)
      .run();
  } catch {
    throw storageUnavailable();
  }
}

async function readBounded(stream: ReadableStream<Uint8Array>, expectedBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const content = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedBytes) {
        await reader.cancel();
        throw invalidContent();
      }
      content.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedBytes) throw invalidContent();
  return content;
}

async function compensateObject(env: ApiEnv, key: string): Promise<void> {
  try {
    await assetBucket(env).delete(key);
  } catch {
    // Orphan sweep reconciles any delete that fails after a D1 write failure.
  }
}

function assetBucket(env: ApiEnv): R2AssetBucket {
  return env.IMPORT_BUCKET as R2AssetBucket;
}

function assertImportId(articleImportId: string): void {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(articleImportId)) {
    throw new ImportStorageError('VALIDATION_ERROR', '导入任务编号格式无效', 400);
  }
}

function assertPosition(position: number): void {
  if (!Number.isInteger(position) || position < 0 || position > 9) {
    throw new ImportStorageError('VALIDATION_ERROR', '文件位置格式无效', 400);
  }
}

function assertSize(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    throw new ImportStorageError('VALIDATION_ERROR', '上传文件不能为空', 400);
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) throw tooLarge('上传文件过大');
}

function normalizeMediaType(value: string): string {
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!MEDIA_TYPES.has(mediaType)) {
    throw new ImportStorageError('IMPORT_UNSUPPORTED_TYPE', '上传文件类型不匹配', 422);
  }
  return mediaType;
}

function assertObjectKey(row: AssetRow): void {
  if (!row.object_key.startsWith(`${OBJECT_PREFIX}${row.article_import_id}/${row.position}/`)) {
    throw invalidContent();
  }
}

function toPublicAsset(row: AssetRow): StoredImportAsset {
  return {
    articleImportId: row.article_import_id,
    position: row.position,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function changes(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('meta' in result)) return 0;
  const meta = result.meta;
  if (typeof meta !== 'object' || meta === null || !('changes' in meta)) return 0;
  return typeof meta.changes === 'number' ? meta.changes : 0;
}

function boundedBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_SWEEP_BATCH;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError('Invalid asset cleanup batch size');
  }
  // D1 currently allows at most 100 bound parameters per statement.
  return Math.min(batchSize, 100);
}

function hexDigest(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function conflict(message: string): ImportStorageError {
  return new ImportStorageError('STATE_CONFLICT', message, 409);
}

function invalidContent(): ImportStorageError {
  return new ImportStorageError('IMPORT_CONTENT_INVALID', '导入文件不完整', 422);
}

function tooLarge(message: string): ImportStorageError {
  return new ImportStorageError('IMPORT_TOO_LARGE', message, 413);
}

function storageUnavailable(): ImportStorageError {
  return new ImportStorageError(
    'DATABASE_UNAVAILABLE',
    '存储服务暂时不可用',
    503,
    true,
  );
}
