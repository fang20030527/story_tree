import { describe, expect, it } from 'vitest';

import { validateTranslationText } from './handler';

describe('translation output validation', () => {
  it('accepts non-empty Han-script output and trims only outer whitespace', () => {
    expect(validateTranslationText('  译文：自然的中文翻译。\n')).toBe(
      '译文：自然的中文翻译。',
    );
  });

  it.each(['', '   \n', 'English text only.'])(
    'rejects unusable output %j',
    (output) => {
      expect(() => validateTranslationText(output)).toThrowError(
        expect.objectContaining({ code: 'AI_INVALID_OUTPUT', retryable: true }),
      );
    },
  );
});
