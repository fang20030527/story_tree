import {
  UNLISTED_MEANING_ZH,
  resolveDraftMeanings,
  validateVocabularyDraft,
  withTerm,
} from './practiceDraft';

const row = (term: string, meaningZh = '', sourceSentence = '') => ({ term, meaningZh, sourceSentence });

describe('resolveDraftMeanings', () => {
  it('fills meanings from the bundled dictionary without touching saved meanings', () => {
    const rows = [row('resilient'), row('lethal', '致命的', 'A lethal dose.'), row('')];
    const resolved = resolveDraftMeanings(rows, true);
    expect(resolved[0].meaningZh).toContain('有弹性的');
    expect(resolved[1]).toBe(rows[1]);
    expect(resolved[2]).toBe(rows[2]);
  });

  it('only marks unknown words as unlisted when asked to', () => {
    const rows = [row('qzxvbnm')];
    expect(resolveDraftMeanings(rows, false)).toBe(rows);
    expect(resolveDraftMeanings(rows, true)[0].meaningZh).toBe(UNLISTED_MEANING_ZH);
  });

  it('clears the old meaning and sentence when the word changes', () => {
    const saved = row('lethal', '致命的', 'A lethal dose.');
    expect(withTerm(saved, 'lethal')).toBe(saved);
    expect(withTerm(saved, 'lethally')).toEqual(row('lethally'));
  });
});

describe('validateVocabularyDraft', () => {
  it('returns the trimmed request, skipping blank rows and empty source sentences', () => {
    const result = validateVocabularyDraft([
      row('  resilient  ', '  有韧性的  ', '   '),
      row('   '),
    ]);

    expect(result).toEqual({
      success: true,
      request: { items: [{ term: 'resilient', meaningZh: '有韧性的' }] },
      rowErrors: [{}, {}],
      formError: null,
    });
  });

  it('sends unlisted words with the placeholder meaning the contract accepts', () => {
    const result = validateVocabularyDraft([row('qzxvbnm', UNLISTED_MEANING_ZH)]);
    expect(result.request?.items).toEqual([{ term: 'qzxvbnm', meaningZh: UNLISTED_MEANING_ZH }]);
  });

  it('flags a repeated word on the term', () => {
    const result = validateVocabularyDraft([
      row('Resilient', '有  韧性的'),
      row('  ＲＥＳＩＬＩＥＮＴ ', ' 有 韧性的 ', 'A different example sentence.'),
    ]);

    expect(result.success).toBe(false);
    expect(result.rowErrors[1]).toEqual({ term: '这个单词已经录入过了' });
  });

  it('waits for pending lookups without showing an error', () => {
    const result = validateVocabularyDraft([row('resilient')]);
    expect(result).toEqual({ success: false, request: null, rowErrors: [{}], formError: null });
  });

  it('asks for at least one word', () => {
    expect(validateVocabularyDraft([row('')]).formError).toBe('请至少录入 1 个单词');
  });
});
