import { describe, expect, it } from 'vitest';

import {
  assertTranslationModerationAccepted,
  createTranslationSourceHash,
  validateTranslationText,
} from './validation';

describe('shared translation validation', () => {
  it('accepts safe Han output and rejects invalid output or moderation', () => {
    expect(validateTranslationText('  译文：这是原创测试内容。 ')).toBe(
      '译文：这是原创测试内容。',
    );
    expect(() => validateTranslationText('English only')).toThrowError(
      expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }),
    );
    expect(() =>
      assertTranslationModerationAccepted({ riskLevel: 'high', flagged: true }),
    ).toThrowError(expect.objectContaining({ code: 'AI_CONTENT_REJECTED' }));
  });

  it('binds source hashes to resource, scope, paragraph, and exact text', () => {
    const base = createTranslationSourceHash(
      'article-a',
      'paragraph',
      'paragraph-a',
      'Original source text.',
    );
    expect(base).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      createTranslationSourceHash(
        'article-a',
        'full',
        null,
        'Original source text.',
      ),
    ).not.toBe(base);
    expect(
      createTranslationSourceHash(
        'article-b',
        'paragraph',
        'paragraph-a',
        'Original source text.',
      ),
    ).not.toBe(base);
  });
});
