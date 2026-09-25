import { AppError } from '../../../../server/src/core/errors';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/u;

export function parseBearerToken(header: string | null): string {
  const match = /^Bearer ([0-9a-f]{64})$/u.exec(header ?? '');
  if (!match) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  return match[1]!;
}

export async function hashInstallationToken(token: string): Promise<string> {
  if (!TOKEN_PATTERN.test(token)) {
    throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
