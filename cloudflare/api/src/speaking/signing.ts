import { SPEAKING_MAX_MEDIA_BYTES } from '@context-reader/contracts';
import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

export const SPEAKING_SIGNED_URL_SECONDS = 600;
/** 固定影片动辄两三小时且经常拖动；只读播放链接给一小时，播放器报错时客户端再续期。 */
export const SPEAKING_CATALOG_PLAYBACK_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const encoder = new TextEncoder();

/** 签名仅限已发布素材与用户资产，禁止 URL、路径穿越和额外查询参数。 */
export function assertSpeakingObjectKey(key: string): void {
  const parts = key.split('/');
  if (!key || key.length > 512 || parts.some(part =>
    !part || part.length > 128 || /[^A-Za-z0-9._-]/u.test(part) ||
    !/^[A-Za-z0-9_-]/u.test(part) || part.endsWith('.'),
  )) throw invalidKey();
  const platform = parts[0] === 'speaking' && parts[1] === 'platform' && parts.length >= 3;
  const personal = parts[0] === 'users' && parts.length >= 4 &&
    UUID.test(parts[1]!) && UUID.test(parts[2]!);
  if (!platform && !personal) throw invalidKey();
}

/** AWS SigV4 查询签名；只使用 Workers WebCrypto，不访问对象或引入 Node SDK。 */
export async function signSpeakingObject(
  env: ApiEnv,
  key: string,
  method: 'GET' | 'PUT',
  contentType?: string,
  byteSize?: number,
  expiresSeconds: number = SPEAKING_SIGNED_URL_SECONDS,
): Promise<string> {
  assertSpeakingObjectKey(key);
  if (method !== 'GET' && method !== 'PUT') throw invalidKey();
  if (!Number.isSafeInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > SPEAKING_CATALOG_PLAYBACK_SECONDS ||
      (method === 'PUT' && expiresSeconds > SPEAKING_SIGNED_URL_SECONDS)) {
    throw new AppError('VALIDATION_ERROR', '媒体链接有效期无效', 400);
  }
  if (method === 'PUT' && (
    !contentType || contentType.length > 128 || /[^a-z0-9!#$&^_.+/-]/iu.test(contentType) ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(contentType) ||
    !Number.isSafeInteger(byteSize) || byteSize! <= 0 || byteSize! > SPEAKING_MAX_MEDIA_BYTES
  )) throw new AppError('VALIDATION_ERROR', '上传文件的类型或大小无效', 400);
  const { accountId, bucketName, accessKeyId, secretAccessKey } = signingConfig(env);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const path = `/${encode(bucketName)}/${key.split('/').map(encode).join('/')}`;
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/gu, '');
  const shortDate = date.slice(0, 8);
  const scope = `${shortDate}/auto/s3/aws4_request`;
  const headers: Record<string, string> = { host };
  if (method === 'PUT') {
    // 同一能力不能扩大预留容量，也不能覆盖已确认或正在确认的对象。
    headers['content-length'] = String(byteSize);
    headers['content-type'] = contentType!;
    headers['if-none-match'] = '*';
  }
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', date],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ].map(([name, value]) => `${encode(name!)}=${encode(value!)}`).sort().join('&');
  const canonicalRequest = [
    method, path, query,
    names.map(name => `${name}:${headers[name]}\n`).join(''),
    signedHeaders, 'UNSIGNED-PAYLOAD',
  ].join('\n');
  try {
    const requestHash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest)));
    const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${requestHash}`;
    let signingKey = await hmac(encoder.encode(`AWS4${secretAccessKey}`), shortDate);
    signingKey = await hmac(signingKey, 'auto');
    signingKey = await hmac(signingKey, 's3');
    signingKey = await hmac(signingKey, 'aws4_request');
    const signature = hex(await hmac(signingKey, stringToSign));
    return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
  } catch {
    throw new AppError('MEDIA_UNAVAILABLE', '媒体地址暂时无法生成，请稍后重试', 503, true);
  }
}

function signingConfig(env: ApiEnv) {
  const accountId = env.R2_ACCOUNT_ID;
  const bucketName = env.R2_BUCKET_NAME;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!accountId || accountId.length !== 32 || !/^[a-f0-9]{32}$/iu.test(accountId) ||
      !bucketName || bucketName.length < 3 || bucketName.length > 63 ||
      /[^a-z0-9-]/u.test(bucketName) || !/^[a-z0-9].*[a-z0-9]$/u.test(bucketName) ||
      !accessKeyId || accessKeyId.length > 256 || /[^A-Za-z0-9_-]/u.test(accessKeyId) ||
      !secretAccessKey || secretAccessKey.length > 256 || /[^!-~]/u.test(secretAccessKey)) {
    throw new AppError('MEDIA_STORAGE_NOT_CONFIGURED', '口语云端存储尚未配置', 503, true);
  }
  return { accountId: accountId.toLowerCase(), bucketName, accessKeyId, secretAccessKey };
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmac(key: Uint8Array<ArrayBuffer>, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey('raw', key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)));
}

function hex(value: ArrayBuffer | Uint8Array): string {
  return Array.from(value instanceof Uint8Array ? value : new Uint8Array(value),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

function invalidKey() {
  return new AppError('VALIDATION_ERROR', '媒体资源标识无效', 400);
}
