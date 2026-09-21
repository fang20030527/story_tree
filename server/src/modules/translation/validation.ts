import { createHash } from 'node:crypto';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import type { ModerationResult } from '../../infrastructure/ai/types';

const TranslationEnvelopeSchema = z.union([
  z.object({ sourceText: z.string() }).strict(),
  z.object({ translatedTextZh: z.string() }).strict(),
]);

export function validateTranslationText(text: string): string {
  let trimmed = text.trim();
  const fenced = /^```(?:json|text)?\s*\n([\s\S]*?)\n```$/iu.exec(trimmed);
  if (fenced) trimmed = fenced[1]!.trim();

  // Some models mirror the sourceText input envelope instead of returning prose.
  // Only unwrap recognized, unambiguous shapes; never display raw structured data.
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw invalidTranslation();
    }
    if (typeof value === 'string') {
      trimmed = value.trim();
    } else {
      const parsed = TranslationEnvelopeSchema.safeParse(value);
      if (!parsed.success) throw invalidTranslation();
      trimmed = ('sourceText' in parsed.data
        ? parsed.data.sourceText
        : parsed.data.translatedTextZh).trim();
    }
  }
  if (!trimmed || !/\p{Script=Han}/u.test(trimmed)
    || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```')) {
    throw invalidTranslation();
  }
  return trimmed;
}

function invalidTranslation(): AppError {
  return new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
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
