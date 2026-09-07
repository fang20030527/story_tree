export const errorCodes = [
  'VALIDATION_ERROR',
  'AGE_CONFIRMATION_REQUIRED',
  'UNAUTHORIZED',
  'TOKEN_REVOKED',
  'NOT_FOUND',
  'STATE_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'FREE_LIMIT_REACHED',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_INVALID_OUTPUT',
  'AI_CONTENT_REJECTED',
  'GENERATION_DEADLINE_EXCEEDED',
  'DATABASE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
