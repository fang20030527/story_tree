import { createHash } from 'node:crypto';

import { AppError } from '../../core/errors';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function parseBearerToken(header: string | undefined): string {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(header ?? '');
  if (!match) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  return match[1]!;
}

export function hashInstallationToken(token: string): string {
  if (!TOKEN_PATTERN.test(token)) {
    throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
