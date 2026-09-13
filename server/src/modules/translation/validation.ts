import { createHash } from 'node:crypto';

import { AppError } from '../../core/errors';
import type { ModerationResult } from '../../infrastructure/ai/types';

export function validateTranslationText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !/\p{Script=Han}/u.test(trimmed)) {
    throw new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
  }
  return trimmed;
}

export function assertTranslationModerationAccepted(
  result: ModerationResult,
): void {
  if (result.riskLevel === 'high' || result.flagged) {
    throw new AppError(
      'AI_CONTENT_REJECTED',
      '翻译结果未通过安全检查',
      502,
      true,
    );
  }
}

export function createTranslationSourceHash(
  resourceId: string,
  scope: 'paragraph' | 'full',
  paragraphId: string | null,
  sourceText: string,
): string {
  return createHash('sha256')
    .update(
      `${resourceId}\u0000${scope}\u0000${paragraphId ?? ''}\u0000${sourceText}`,
      'utf8',
    )
    .digest('hex');
}
