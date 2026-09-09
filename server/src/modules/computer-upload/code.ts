import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { AppError } from '../../core/errors';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/u;
const FIELD_SEPARATOR = String.fromCharCode(0);

export function deriveUploadCode(
  installationToken: string,
  userId: string,
  sessionId: string,
): string {
  const digest = createHmac('sha256', installationToken)
    .update(
      'context-reader-computer-upload-v1' +
        FIELD_SEPARATOR +
        userId +
        FIELD_SEPARATOR +
        sessionId,
      'utf8',
    )
    .digest();
  let value = digest.readBigUInt64BE(0) & ((1n << 50n) - 1n);
  let code = '';
  for (let index = 0; index < 10; index += 1) {
    code = ALPHABET[Number(value & 31n)]! + code;
    value >>= 5n;
  }
  return code;
}

export function normalizeUploadCode(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/[\s-]/gu, '')
    .replace(/O/gu, '0')
    .replace(/[IL]/gu, '1');
  if (!CODE_PATTERN.test(normalized)) {
    throw new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
  }
  return normalized;
}

export function hashUploadCode(code: string): string {
  return createHash('sha256')
    .update(normalizeUploadCode(code), 'utf8')
    .digest('hex');
}

export function createCapabilityToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return {
    raw,
    hash: hashCapabilityToken(raw),
  };
}

export function hashCapabilityToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function capabilityMatches(raw: string, expectedHash: string): boolean {
  const actual = createHash('sha256').update(raw, 'utf8').digest();
  const expected = Buffer.from(expectedHash, 'hex');
  return (
    expected.byteLength === actual.byteLength &&
    timingSafeEqual(actual, expected)
  );
}
