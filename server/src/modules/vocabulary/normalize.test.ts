import { describe, expect, it } from 'vitest';

import {
  normalizeMeaningZh,
  normalizeTerm,
  rejectDuplicateInputs,
  vocabularyFingerprint,
} from './normalize';

describe('vocabulary normalization', () => {
  it('normalizes only deterministic display differences', () => {
    expect(normalizeTerm('  ReSILIENT\u3000')).toBe('resilient');
    expect(normalizeMeaningZh('  有  韧性 的。 ')).toBe('有 韧性 的。');
    expect(vocabularyFingerprint('Charge', '收费')).toBe(
      vocabularyFingerprint(' charge ', ' 收费 '),
    );
    expect(vocabularyFingerprint('charge', '收费')).not.toBe(
      vocabularyFingerprint('charge', '指控'),
    );
  });

  it('rejects exact duplicate senses within one request', () => {
    expect(() =>
      rejectDuplicateInputs([
        { term: 'Charge', meaningZh: '收费' },
        { term: ' charge ', meaningZh: ' 收费 ' },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
