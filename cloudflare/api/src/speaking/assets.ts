import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import {
  CompleteSpeakingAssetRequestSchema, CreateSpeakingAssetRequestSchema,
  SPEAKING_MAX_MEDIA_BYTES, SPEAKING_MAX_SUBTITLE_BYTES,
  SpeakingAssetDtoSchema, SpeakingCapabilitiesDtoSchema, SpeakingPlaybackDtoSchema,
  UuidSchema, type SpeakingAssetDto,
} from '@context-reader/contracts';
import { AppError } from '../../../../server/src/core/errors';
import { pronunciationCapability } from '../../../../server/src/modules/speaking/pronunciation-shared';
import { readJsonBody } from '../core/http';
import { getEvolinkAudioSettings, type ApiEnv } from '../env';
import { signSpeakingObject } from './signing';

const USER_BYTES = 10 * 1024 ** 3;
const ASSET_TTL_MS = 86_400_000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const OWNED_KEY = /^users\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/source$/u;
const RECORDING_BYTES = 50 * 1024 ** 2;

interface AssetRow {
  id: string; user_id: string; status: 'awaiting_upload' | 'ready';
  content_type: SpeakingAssetDto['contentType']; byte_size: number; purpose: 'material' | 'recording';
  storage_key: string; duration: number; media_type: 'audio' | 'video' | null;
  expires_at: string; attached_at: string | null; etag: string | null;
}
interface IdempotencyRow { request_hash: string; resource_id: string }

function storage(env: ApiEnv) {
  if (!env.SPEAKING_BUCKET || !env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    throw new AppError('MEDIA_STORAGE_NOT_CONFIGURED', '口语媒体服务尚未配置', 503, true);
  }
  return env.SPEAKING_BUCKET;
}
function requireKey(request: Request): string {
  const key = request.headers.get('idempotency-key');
  if (!key || !KEY_PATTERN.test(key)) throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  return key;
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function prior(env: ApiEnv, userId: string, operation: string, key: string, hash: string) {
  const row = await env.DB.prepare(`SELECT request_hash, resource_id FROM speaking_idempotency
    WHERE user_id = ? AND operation = ? AND idempotency_key = ?`).bind(userId, operation, key).first<IdempotencyRow>();
  if (row && row.request_hash !== hash) throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  return row;
}
async function owned(env: ApiEnv, userId: string, id: string): Promise<AssetRow> {
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '媒体编号格式无效', 400);
  const row = await env.DB.prepare('SELECT * FROM speaking_assets WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<AssetRow>();
  if (!row) throw new AppError('NOT_FOUND', '媒体文件不存在', 404);
  if (!row.attached_at && Date.parse(row.expires_at) <= Date.now()) {
    throw new AppError('UPLOAD_SESSION_EXPIRED', '媒体上传已过期，请重新选择文件', 410);
  }
  if (!OWNED_KEY.test(row.storage_key) || !row.storage_key.startsWith(`users/${userId}/${id}/`)) {
    throw new AppError('MEDIA_UNAVAILABLE', '媒体文件暂时无法访问', 503, true);
  }
  return row;
}
async function dto(env: ApiEnv, asset: AssetRow) {
  const directUpload = asset.status === 'awaiting_upload' ? {
    url: await signSpeakingObject(env, asset.storage_key, 'PUT', asset.content_type, asset.byte_size),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  } : undefined;
  return SpeakingAssetDtoSchema.parse({
    id: asset.id, status: asset.status, uploadPath: `/v1/speaking/assets/${asset.id}/content`,
    byteSize: asset.byte_size, contentType: asset.content_type, duration: asset.duration,
    expiresAt: asset.expires_at, ...(directUpload ? { directUpload } : {}),
  });
}
function normalizeType(type: string) {
  return type === 'audio/mp3' ? 'audio/mpeg' : ['audio/mp4', 'audio/x-m4a'].includes(type) ? 'audio/mp4'
    : type === 'audio/x-wav' ? 'audio/wav' : type;
}
function consistentType(expected: string, detected: string) {
  return normalizeType(expected) === normalizeType(detected) ||
    (expected === 'audio/webm' && detected === 'video/webm');
}

async function createAsset(request: Request, env: ApiEnv, userId: string) {
  storage(env);
  const key = requireKey(request);
  const parsed = CreateSpeakingAssetRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请检查媒体文件信息', 400);
  const body = parsed.data;
  if (body.purpose === 'recording' && body.byteSize > RECORDING_BYTES) {
    throw new AppError('IMPORT_TOO_LARGE', '录音文件超过允许的大小', 413);
  }
  const hash = digest({ contentType: body.contentType, byteSize: body.byteSize, purpose: body.purpose });
  const previous = await prior(env, userId, 'create_asset', key, hash);
  if (previous) return Response.json(await dto(env, await owned(env, userId, previous.resource_id)), { status: 201 });
  const id = crypto.randomUUID();
  const recordId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ASSET_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO speaking_assets
      (id,user_id,status,content_type,byte_size,purpose,storage_key,duration,media_type,expires_at,attached_at,created_at,etag)
      SELECT ?,?,'awaiting_upload',?,?,?, ?,0,NULL,?,NULL,?,NULL
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM speaking_idempotency WHERE user_id = ? AND operation = 'create_asset' AND idempotency_key = ?)
        AND (SELECT COALESCE(SUM(byte_size),0) FROM speaking_assets WHERE user_id = ? AND (attached_at IS NOT NULL OR expires_at > ?)) + ? <= ?
        AND (SELECT COUNT(*) FROM speaking_assets WHERE user_id = ? AND (attached_at IS NOT NULL OR expires_at > ?)) < 1000`)
      .bind(id, userId, body.contentType, body.byteSize, body.purpose, `users/${userId}/${id}/source`, expiresAt, now,
        userId, userId, key, userId, now, body.byteSize, USER_BYTES, userId, now),
    env.DB.prepare(`INSERT INTO speaking_idempotency
      (id,user_id,operation,idempotency_key,request_hash,resource_id,created_at)
      SELECT ?,?,'create_asset',?,?,?,? WHERE EXISTS (SELECT 1 FROM speaking_assets WHERE id = ? AND user_id = ?)
      ON CONFLICT(user_id,operation,idempotency_key) DO NOTHING`)
      .bind(recordId, userId, key, hash, id, now, id, userId),
  ]);
  const saved = await prior(env, userId, 'create_asset', key, hash);
  if (!saved) throw new AppError('MEDIA_STORAGE_LIMIT_REACHED', '账号媒体空间已满，请减少文件后重试', 409);
  return Response.json(await dto(env, await owned(env, userId, saved.resource_id)), { status: 201 });
}

async function completeAsset(request: Request, env: ApiEnv, userId: string, id: string) {
  const bucket = storage(env);
  const key = requireKey(request);
  const parsed = CompleteSpeakingAssetRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '媒体时长无效', 400);
  const duration = parsed.data.duration;
  const asset = await owned(env, userId, id);
  if (asset.purpose === 'recording' && (duration > 600 || !asset.content_type.startsWith('audio/'))) {
    throw new AppError('IMPORT_CONTENT_INVALID', '录音需要音频格式且最长十分钟', 422);
  }
  const hash = digest({ id, duration });
  const previous = await prior(env, userId, 'complete_asset', key, hash);
  if (previous && previous.resource_id !== id) throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  const object = await bucket.head(asset.storage_key);
  if (!object) throw new AppError('MEDIA_UNAVAILABLE', '媒体尚未完成上传，请重试', 409, true);
  if (object.size !== asset.byte_size || normalizeType(object.httpMetadata?.contentType ?? '') !== normalizeType(asset.content_type)) {
    throw new AppError('IMPORT_CONTENT_INVALID', '实际媒体大小或类型与预留信息不一致', 422);
  }
  const etag = object.etag;
  if (asset.status === 'ready') {
    if (asset.etag !== etag || asset.duration !== duration) throw new AppError('STATE_CONFLICT', '媒体已使用不同内容确认，请重新选择文件', 409);
    return Response.json(await dto(env, asset));
  }
  const sample = await bucket.get(asset.storage_key, { range: { offset: 0, length: Math.min(65_536, asset.byte_size) } });
  if (!sample) throw new AppError('MEDIA_UNAVAILABLE', '媒体暂时无法读取，请重试', 503, true);
  const bytes = new Uint8Array(await new Response(sample.body).arrayBuffer());
  const detected = await fileTypeFromBuffer(bytes).catch(() => undefined);
  if (!detected || !consistentType(asset.content_type, detected.mime)) {
    throw new AppError('IMPORT_UNSUPPORTED_TYPE', '请选择有效且与声明格式一致的音视频文件', 422);
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE speaking_assets SET status = 'ready',duration = ?,media_type = ?,etag = ?
      WHERE id = ? AND user_id = ? AND status = 'awaiting_upload'
        AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND NOT EXISTS (SELECT 1 FROM speaking_idempotency WHERE user_id = ? AND operation = 'complete_asset' AND idempotency_key = ?)`)
      .bind(duration, asset.content_type.startsWith('video/') ? 'video' : 'audio', etag, id, userId, userId, key),
    env.DB.prepare(`INSERT INTO speaking_idempotency
      (id,user_id,operation,idempotency_key,request_hash,resource_id,created_at)
      SELECT ?,?,'complete_asset',?,?,?,? WHERE EXISTS
        (SELECT 1 FROM speaking_assets WHERE id = ? AND user_id = ? AND status = 'ready' AND duration = ? AND etag = ?)
      ON CONFLICT(user_id,operation,idempotency_key) DO NOTHING`)
      .bind(crypto.randomUUID(), userId, key, hash, id, now, id, userId, duration, etag),
  ]);
  await prior(env, userId, 'complete_asset', key, hash);
  const result = await owned(env, userId, id);
  if (result.status !== 'ready' || result.duration !== duration || result.etag !== etag) {
    throw new AppError('STATE_CONFLICT', '上传确认发生冲突，请重试', 409, true);
  }
  return Response.json(await dto(env, result));
}

export async function handleSpeakingAssetRoute(request: Request, env: ApiEnv, userId: string): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/v1/speaking/capabilities') {
    storage(env);
    return Response.json(SpeakingCapabilitiesDtoSchema.parse({ storage: 'r2', maxMediaBytes: SPEAKING_MAX_MEDIA_BYTES,
      maxSubtitleBytes: SPEAKING_MAX_SUBTITLE_BYTES, autoSubtitles: false,
      pronunciation: pronunciationCapability(getEvolinkAudioSettings(env).apiKey) }));
  }
  if (request.method === 'POST' && path === '/v1/speaking/assets') return createAsset(request, env, userId);
  const match = /^\/v1\/speaking\/assets\/([^/]+)\/(complete|playback|content)$/u.exec(path);
  if (!match) return null;
  const id = match[1]!;
  if (request.method === 'POST' && match[2] === 'complete') return completeAsset(request, env, userId, id);
  if (request.method === 'GET' && match[2] === 'playback') {
    const bucket = storage(env);
    const asset = await owned(env, userId, id);
    if (asset.status !== 'ready') throw new AppError('MEDIA_UNAVAILABLE', '媒体尚未完成上传', 409, true);
    const object = await bucket.head(asset.storage_key);
    if (!object || object.size !== asset.byte_size || object.etag !== asset.etag) {
      throw new AppError('MEDIA_UNAVAILABLE', '媒体文件暂时无法访问', 503, true);
    }
    return Response.json(SpeakingPlaybackDtoSchema.parse({
      url: await signSpeakingObject(env, asset.storage_key, 'GET'), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }), { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }
  if (request.method === 'PUT' && match[2] === 'content') {
    throw new AppError('VALIDATION_ERROR', '请使用服务端返回的云端直传地址上传媒体', 400);
  }
  return null;
}

/** 只清理本模块创建且过期未绑定的个人对象，固定素材不在此范围。 */
export async function sweepSpeakingAssets(env: ApiEnv): Promise<void> {
  if (!env.SPEAKING_BUCKET) return;
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`SELECT id,user_id,storage_key FROM speaking_assets
    WHERE attached_at IS NULL AND expires_at <= ? ORDER BY expires_at LIMIT 20`).bind(now)
    .all<Pick<AssetRow, 'id' | 'user_id' | 'storage_key'>>();
  for (const row of rows.results) {
    if (!OWNED_KEY.test(row.storage_key) || row.storage_key !== `users/${row.user_id}/${row.id}/source`) continue;
    // D1 serializes the claim with material/recording attachment. The cleanup
    // pointer survives a transient R2 error after removing an expired asset.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO speaking_storage_cleanup (storage_key,created_at)
        SELECT storage_key,? FROM speaking_assets WHERE id = ? AND user_id = ?
          AND storage_key = ? AND attached_at IS NULL AND expires_at <= ?
        ON CONFLICT(storage_key) DO NOTHING`)
        .bind(now, row.id, row.user_id, row.storage_key, now),
      env.DB.prepare(`DELETE FROM speaking_assets WHERE id = ? AND user_id = ?
        AND attached_at IS NULL AND expires_at <= ?
        AND EXISTS (SELECT 1 FROM speaking_storage_cleanup WHERE storage_key = speaking_assets.storage_key)`)
        .bind(row.id, row.user_id, now),
    ]);
  }
  const pending = await env.DB.prepare('SELECT storage_key FROM speaking_storage_cleanup ORDER BY created_at LIMIT 20')
    .all<{ storage_key: string }>();
  for (const row of pending.results) {
    if (!OWNED_KEY.test(row.storage_key)) continue;
    try {
      await env.SPEAKING_BUCKET.delete(row.storage_key);
      await env.DB.prepare('DELETE FROM speaking_storage_cleanup WHERE storage_key = ?').bind(row.storage_key).run();
    } catch {
      // Retain only the internal pointer; retries never log keys or user data.
    }
  }
}
