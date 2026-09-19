import { WordTranslationDtoSchema } from '@context-reader/contracts';

import { lookupLocalWord } from './lookup';

describe('bundled Cambridge dictionary', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn(() => { throw new Error('查词不得联网'); });

  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as typeof fetch;
  });
  afterEach(() => {
    expect(fetchMock).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });

  it('reads the real bilingual dictionary without a token or server', async () => {
    const result = await lookupLocalWord({ term: '  RESILIENT  ', context: 'A resilient reader.' });
    expect(result.term).toBe('RESILIENT');
    expect(result.partOfSpeech).toBe('adj.');
    expect(result.meaningZh).toContain('有弹性的');
    expect(result.phoneticUk).toContain('rɪ');
    expect(result.phoneticUs).toContain('rɪ');
    expect(WordTranslationDtoSchema.safeParse(result).success).toBe(true);
  });

  it('preserves multiple senses rather than claiming contextual disambiguation', async () => {
    const money = await lookupLocalWord({ term: 'bank', context: 'I save money.' });
    const river = await lookupLocalWord({ term: 'bank', context: 'I sit by a river.' });
    expect(money).toEqual(river);
    expect(money.meaningZh).toContain('银行');
    expect(money.meaningZh).toContain('岸');
    expect(money.meaningZh).toContain('v.');
    expect(money.meaningZh.length).toBeLessThanOrEqual(200);
  });

  it.each(['apples', 'studied', 'making', 'readers'])('resolves the real word form %s', async (term) => {
    const result = await lookupLocalWord({ term });
    expect(result.term).toBe(term);
    expect(result.meaningZh).toMatch(/[\u3400-\u9fff]/u);
  });

  it('includes the base meaning for an irregular past tense', async () => {
    const result = await lookupLocalWord({ term: 'went' });
    expect(result.meaningZh).toContain('go');
    expect(result.meaningZh).toMatch(/去|走/u);
    expect(result.phoneticUk).toBe('/went/');
  });

  it('does not stem a word with its own dictionary entry', async () => {
    const result = await lookupLocalWord({ term: 'running' });
    expect(result.meaningZh).toContain('跑步');
    expect(result.meaningZh).toContain('连续');
  });

  it('resolves duplicate source aliases to the matching stem', async () => {
    const restored = await lookupLocalWord({ term: 'restores' });
    const restore = await lookupLocalWord({ term: 'restore' });
    expect(restored.meaningZh).toBe(restore.meaningZh);
  });

  it('normalizes curly apostrophes and refuses prototype keys', async () => {
    expect(await lookupLocalWord({ term: 'don’t' })).toEqual(
      { ...await lookupLocalWord({ term: "don't" }), term: 'don’t' },
    );
    await expect(lookupLocalWord({ term: '__proto__' })).rejects.toThrow('本地词典未收录这个词');
  });

  it('reports missing and invalid words without an API fallback', async () => {
    await expect(lookupLocalWord({ term: 'zznotadictionarywordzz' })).rejects.toThrow('本地词典未收录这个词');
    await expect(lookupLocalWord({ term: '   ' })).rejects.toThrow('词语格式无效');
    await expect(lookupLocalWord({ term: 'a'.repeat(81) })).rejects.toThrow('词语格式无效');
  });
});
