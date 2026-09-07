import { validateVocabularyDraft } from './practiceDraft';

describe('validateVocabularyDraft', () => {
  it('returns the trimmed request and omits an empty source sentence', () => {
    const result = validateVocabularyDraft([
      {
        term: '  resilient  ',
        meaningZh: '  有韧性的  ',
        sourceSentence: '   ',
      },
    ]);

    expect(result).toEqual({
      success: true,
      request: {
        items: [{ term: 'resilient', meaningZh: '有韧性的' }],
      },
      rowErrors: [{}],
      formError: null,
    });
  });

  it('rejects an exact term-and-meaning duplicate after normalization', () => {
    const result = validateVocabularyDraft([
      {
        term: 'Resilient',
        meaningZh: '有  韧性的',
        sourceSentence: '',
      },
      {
        term: '  ＲＥＳＩＬＩＥＮＴ ',
        meaningZh: ' 有 韧性的 ',
        sourceSentence: 'A different example sentence.',
      },
    ]);

    expect(result.success).toBe(false);
    expect(result.rowErrors[1]).toEqual({
      meaningZh: '该单词和义项已重复',
    });
  });
});
