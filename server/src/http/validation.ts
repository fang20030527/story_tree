import { UuidSchema } from '@context-reader/contracts';

import { AppError } from '../core/errors';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  return value;
}

export function parseUuidParam(
  params: unknown,
  name: string,
  message: string,
): string {
  const value =
    typeof params === 'object' && params !== null
      ? (params as Record<string, unknown>)[name]
      : undefined;
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', message, 400);
  }
  return parsed.data;
}
