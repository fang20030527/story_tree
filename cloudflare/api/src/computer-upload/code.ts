import { AppError } from '../../../../server/src/core/errors';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/u;
const encoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Same HMAC input and 50-bit Crockford encoding as the Node service. */
export async function deriveUploadCode(
  installationToken: string,
  userId: string,
  sessionId: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(installationToken),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const input = `context-reader-computer-upload-v1\u0000${userId}\u0000${sessionId}`;
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(input)));
  let value = new DataView(digest.buffer, digest.byteOffset, digest.byteLength)
    .getBigUint64(0, false) & ((1n << 50n) - 1n);
  let code = '';
  for (let index = 0; index < 10; index += 1) {
    code = ALPHABET[Number(value & 31n)]! + code;
    value >>= 5n;
  }
  return code;
}

export function normalizeUploadCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[\s-]/gu, '')
    .replace(/O/gu, '0').replace(/[IL]/gu, '1');
  if (!CODE_PATTERN.test(normalized)) {
    throw new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
  }
  return normalized;
}

export function hashUploadCode(code: string): Promise<string> {
  return sha256(normalizeUploadCode(code));
}

export function hashCapabilityToken(token: string): Promise<string> {
  return sha256(token);
}

export async function createCapabilityToken(): Promise<{ raw: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  return { raw, hash: await hashCapabilityToken(raw) };
}
