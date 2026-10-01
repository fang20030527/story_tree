import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, gt, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { fileTypeFromFile } from 'file-type';
import { SpeakingAssetDtoSchema, type CreateSpeakingAssetRequest } from '@context-reader/contracts';
import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { speakingAssets, speakingStorageCleanup } from '../../db/schema';
import type { FFmpegMediaProcessor } from '../../infrastructure/media/ffmpeg';
import { createMediaStore, type MediaStore } from '../../infrastructure/media/store';
import { beginIdempotentOperation, finishIdempotentOperation } from '../idempotency/service';

type Db = AppDatabase | AppTransaction;
export interface SpeakingMediaDependencies {
  db: AppDatabase;
  config: ServerConfig;
  mediaStore: MediaStore | undefined;
  mediaProcessor: Pick<FFmpegMediaProcessor, 'probe'>;
}

export function configuredSpeakingMediaStore(config: ServerConfig): MediaStore | undefined {
  if (config.SPEAKING_STORAGE_DRIVER === 'disabled') return undefined;
  return createMediaStore(config.SPEAKING_STORAGE_DRIVER === 'r2' ? {
    driver: 'r2', r2: { accountId: config.R2_ACCOUNT_ID, accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY, bucketName: config.R2_BUCKET_NAME },
  } : { driver: 'local', localRoot: resolve(config.SPEAKING_MEDIA_ROOT) });
}

export function requireMediaStore(dependencies: SpeakingMediaDependencies): MediaStore {
  if (!dependencies.mediaStore) throw new AppError('MEDIA_STORAGE_NOT_CONFIGURED', '媒体存储尚未配置，请稍后重试', 503);
  return dependencies.mediaStore;
}

export async function createSpeakingAsset(deps: SpeakingMediaDependencies, userId: string,
  idempotencyKey: string, request: CreateSpeakingAssetRequest) {
  requireMediaStore(deps);
  if (request.byteSize > deps.config.SPEAKING_MAX_MEDIA_BYTES ||
      (request.purpose === 'recording' && request.byteSize > 50 * 1024 ** 2)) {
    throw new AppError('IMPORT_TOO_LARGE', '媒体文件超过允许的大小', 413);
  }
  // 过期未绑定资产不占容量；对象清理由后台重试，不阻塞新的上传预留。
  return deps.db.transaction(async tx => {
    const previous = await beginIdempotentOperation(tx, userId, 'create_speaking_asset', idempotencyKey, request);
    if (previous) return assetDto(await getOwnedSpeakingAsset(tx, userId, previous));
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`speaking-quota:${userId}`}))`);
    const [usage] = await tx.select({ bytes: sql<string>`coalesce(sum(${speakingAssets.byteSize}), 0)`,
      count: sql<number>`count(*)::int` }).from(speakingAssets).where(and(eq(speakingAssets.userId, userId),
      or(isNotNull(speakingAssets.attachedAt), gt(speakingAssets.expiresAt, new Date()))));
    if (Number(usage?.bytes ?? 0) + request.byteSize > deps.config.SPEAKING_USER_STORAGE_BYTES || (usage?.count ?? 0) >= 1000) {
      throw new AppError('MEDIA_STORAGE_LIMIT_REACHED', '账号媒体空间已满，请减少文件后重试', 409);
    }
    const [asset] = await tx.insert(speakingAssets).values({ userId, ...request,
      expiresAt: new Date(Date.now() + deps.config.SPEAKING_ASSET_TTL_MS) }).returning();
    if (!asset) throw internalError();
    await finishIdempotentOperation(tx, userId, 'create_speaking_asset', idempotencyKey, asset.id);
    return assetDto(asset);
  });
}

export async function getOwnedSpeakingAsset(db: Db, userId: string, assetId: string) {
  const [asset] = await db.select().from(speakingAssets)
    .where(and(eq(speakingAssets.id, assetId), eq(speakingAssets.userId, userId))).limit(1);
  if (!asset) throw new AppError('NOT_FOUND', '媒体文件不存在', 404);
  if (!asset.attachedAt && asset.expiresAt.getTime() <= Date.now()) {
    throw new AppError('UPLOAD_SESSION_EXPIRED', '媒体上传已过期，请重新选择文件', 410);
  }
  return asset;
}

export async function uploadSpeakingAsset(deps: SpeakingMediaDependencies, userId: string, assetId: string,
  source: Readable, contentType: string, contentLength: string | undefined, signal: AbortSignal) {
  const store = requireMediaStore(deps);
  let expected = await getOwnedSpeakingAsset(deps.db, userId, assetId);
  if (normalizeType(contentType.split(';')[0] ?? '') !== normalizeType(expected.contentType)) {
    throw new AppError('IMPORT_UNSUPPORTED_TYPE', '媒体类型与上传清单不一致', 415);
  }
  if (contentLength !== undefined && (!/^\d+$/u.test(contentLength) || Number(contentLength) !== expected.byteSize)) {
    throw new AppError('STATE_CONFLICT', '媒体大小与上传清单不一致', 409);
  }
  const temporaryRoot = resolve(deps.config.SPEAKING_MEDIA_ROOT, 'staging');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, 'upload-'));
  const path = join(directory, 'source.bin');
  const abort = AbortSignal.any([signal, AbortSignal.timeout(deps.config.SPEAKING_UPLOAD_TIMEOUT_MS)]);
  const hash = createHash('sha256');
  let bytes = 0;
  let orphanKey: string | undefined;
  const leaseToken = randomUUID();
  try {
    const [leased] = await deps.db.update(speakingAssets).set({ uploadLeaseToken: leaseToken,
      uploadLeaseUntil: new Date(Date.now() + deps.config.SPEAKING_UPLOAD_TIMEOUT_MS + 30_000) })
      .where(and(eq(speakingAssets.id, assetId), eq(speakingAssets.userId, userId),
        or(isNull(speakingAssets.uploadLeaseUntil), lt(speakingAssets.uploadLeaseUntil, new Date())))).returning();
    if (!leased) throw new AppError('STATE_CONFLICT', '此媒体正在上传，请稍后重试', 409, true);
    expected = leased;
    const check = new Transform({ transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > expected.byteSize || bytes > deps.config.SPEAKING_MAX_MEDIA_BYTES) {
        done(new AppError('IMPORT_TOO_LARGE', '媒体文件超过声明的大小', 413)); return;
      }
      hash.update(chunk); done(null, chunk);
    } });
    await pipeline(source, check, createWriteStream(path, { flags: 'wx' }), { signal: abort });
    if (bytes !== expected.byteSize) throw new AppError('STATE_CONFLICT', '媒体文件未完整上传，请重试', 409, true);
    const sha256 = hash.digest('hex');
    if (expected.status === 'ready') {
      if (expected.sha256 !== sha256) throw changedUpload();
      return assetDto(expected);
    }
    const detected = await fileTypeFromFile(path);
    if (!detected || normalizeType(detected.mime) !== normalizeType(expected.contentType)) {
      throw new AppError('IMPORT_UNSUPPORTED_TYPE', '文件内容与声明的媒体类型不一致', 422);
    }
    const metadata = await deps.mediaProcessor.probe(path, abort);
    if (!metadata.hasAudio || (expected.purpose === 'recording' &&
      (metadata.mediaType !== 'audio' || metadata.durationSeconds > 600))) {
      throw new AppError('IMPORT_UNSUPPORTED_TYPE', '请选择含音轨的媒体，录音最长 10 分钟', 422);
    }
    if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0 || metadata.durationSeconds > 86_400) {
      throw new AppError('IMPORT_CONTENT_INVALID', '媒体时长无效', 422);
    }
    const key = `users/${userId}/${assetId}/${sha256}-${leaseToken}/source.${detected.ext}`;
    // 每次尝试独占对象键，失败清理不会误删其他上传已发布的媒体。
    orphanKey = key;
    await deps.db.insert(speakingStorageCleanup).values({ storageKey: key,
      notBefore: new Date(Date.now() + deps.config.SPEAKING_UPLOAD_TIMEOUT_MS + 60_000) });
    await store.putFile(key, path, expected.contentType, abort);
    const actual = await store.stat(key);
    if (actual?.byteSize !== expected.byteSize) throw new AppError('MEDIA_UNAVAILABLE', '媒体保存失败，请重试', 503, true);
    const result = await deps.db.transaction(async tx => {
      abort.throwIfAborted();
      const [current] = await tx.select().from(speakingAssets).where(and(
        eq(speakingAssets.id, assetId), eq(speakingAssets.userId, userId))).for('update');
      if (!current) throw new AppError('NOT_FOUND', '媒体文件不存在', 404);
      if (current.uploadLeaseToken !== leaseToken) throw new AppError('STATE_CONFLICT', '上传已被新请求接替，请重试', 409, true);
      if (current.status === 'ready') {
        if (current.sha256 !== sha256) throw changedUpload();
        return assetDto(current);
      }
      if (current.expiresAt.getTime() <= Date.now()) throw new AppError('UPLOAD_SESSION_EXPIRED', '媒体上传已过期', 410);
      const [ready] = await tx.update(speakingAssets).set({ status: 'ready', storageKey: key, sha256,
        duration: metadata.durationSeconds, mediaType: metadata.mediaType }).where(eq(speakingAssets.id, assetId)).returning();
      if (!ready) throw internalError();
      await tx.delete(speakingStorageCleanup).where(eq(speakingStorageCleanup.storageKey, key));
      return assetDto(ready);
    });
    orphanKey = undefined;
    return result;
  } catch (error) {
    if (orphanKey) {
      // 失败不丢失对象键；即使存储暂时不可达，清理器仍能继续重试。
      await deps.db.update(speakingStorageCleanup).set({ notBefore: new Date() })
        .where(eq(speakingStorageCleanup.storageKey, orphanKey)).catch(() => undefined);
    }
    if (error instanceof AppError) throw error;
    throw new AppError('MEDIA_UNAVAILABLE', abort.aborted ? '媒体上传超时或已取消，请重试' : '媒体上传失败，请重试', 503, true);
  } finally {
    await deps.db.update(speakingAssets).set({ uploadLeaseToken: null, uploadLeaseUntil: null })
      .where(and(eq(speakingAssets.id, assetId), eq(speakingAssets.uploadLeaseToken, leaseToken))).catch(() => undefined);
    await removeUploadDirectory(temporaryRoot, directory);
  }
}

export async function sweepSpeakingAssets(deps: SpeakingMediaDependencies, userId?: string) {
  if (!deps.mediaStore) return;
  await deps.db.transaction(async tx => {
    const expired = await tx.select().from(speakingAssets).where(and(isNull(speakingAssets.attachedAt),
      lt(speakingAssets.expiresAt, new Date()),
      or(isNull(speakingAssets.uploadLeaseUntil), lt(speakingAssets.uploadLeaseUntil, new Date())),
      ...(userId ? [eq(speakingAssets.userId, userId)] : []))).limit(100).for('update', { skipLocked: true });
    for (const asset of expired) {
      if (asset.storageKey) await tx.insert(speakingStorageCleanup).values({ storageKey: asset.storageKey,
        notBefore: new Date() }).onConflictDoNothing();
      await tx.delete(speakingAssets).where(eq(speakingAssets.id, asset.id));
    }
  });
  const due = await deps.db.select().from(speakingStorageCleanup).where(lte(speakingStorageCleanup.notBefore, new Date())).limit(100);
  for (const object of due) {
    try {
      await deps.mediaStore.delete(object.storageKey);
      await deps.db.delete(speakingStorageCleanup).where(eq(speakingStorageCleanup.storageKey, object.storageKey));
    } catch {
      await deps.db.update(speakingStorageCleanup).set({ notBefore: new Date(Date.now() + 300_000) })
        .where(eq(speakingStorageCleanup.storageKey, object.storageKey));
    }
  }
}

function assetDto(asset: typeof speakingAssets.$inferSelect) {
  return SpeakingAssetDtoSchema.parse({ id: asset.id, status: asset.status,
    uploadPath: `/v1/speaking/assets/${asset.id}/content`, byteSize: asset.byteSize,
    contentType: asset.contentType, duration: asset.duration, expiresAt: asset.expiresAt.toISOString() });
}
function normalizeType(type: string) {
  const aliases: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav',
    'audio/vnd.wave': 'audio/wav', 'audio/x-m4a': 'audio/mp4', 'audio/webm': 'video/webm' };
  const value = type.toLowerCase().trim();
  return aliases[value] ?? value;
}
function changedUpload() { return new AppError('STATE_CONFLICT', '此媒体已上传，重试内容不一致', 409); }
function internalError() { return new AppError('INTERNAL_ERROR', '媒体状态无效，请重试', 500, true); }
async function removeUploadDirectory(root: string, directory: string) {
  const target = resolve(directory);
  const child = relative(resolve(root), target);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw internalError();
  await rm(target, { recursive: true, force: true });
}
