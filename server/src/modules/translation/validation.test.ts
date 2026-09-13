import { describe, expect, it } from 'vitest';

import {
  assertTranslationModerationAccepted,
  createTranslationSourceHash,
  validateTranslationText,
} from './validation';

describe('shared translation validation', () => {
  it('accepts safe Han output and rejects invalid output', () => {
    expect(validateTranslationText('  译文：这是原创测试内容。 ')).toBe(
      '译文：这是原创测试内容。',
    );
    expect(() => validateTranslationText('English only')).toThrowError(
      expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }),
    );
  });

  it('allows unflagged medium-risk translations and blocks flagged or high-risk output', () => {
    expect(() =>
      assertTranslationModerationAccepted({
        riskLevel: 'medium',
        flagged: false,
      }),
    ).not.toThrow();

    expect(() =>
      assertTranslationModerationAccepted({ riskLevel: 'low', flagged: true }),
    ).toThrowError(expect.objectContaining({ code: 'AI_CONTENT_REJECTED' }));
    expect(() =>
      assertTranslationModerationAccepted({ riskLevel: 'high', flagged: false }),
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
