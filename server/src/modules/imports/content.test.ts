import { describe, expect, it } from 'vitest';

import {
  countEnglishWords,
  hammingDistance64,
  isSimilarContent,
  normalizeImportContent,
  normalizePastedContent,
} from './content';

const FIRST_PARAGRAPH =
  'Careful readers compare evidence before they accept a broad public claim.';
const SECOND_PARAGRAPH =
  'They preserve context, inspect uncertainty, and revise conclusions when reliable facts change.';
const SYNTHETIC_PROSE = `${FIRST_PARAGRAPH}\r\n \r\n${SECOND_PARAGRAPH}`;
const ENGLISH_SEQUENCE = [
  'careful',
  'readers',
  'compare',
  'reliable',
  'evidence',
  'before',
  'forming',
  'measured',
  'public',
  'conclusions',
] as const;

function englishWords(length: number): string {
  return Array.from(
    { length },
    (_, index) => ENGLISH_SEQUENCE[index % ENGLISH_SEQUENCE.length],
  ).join(' ');
}

describe('article import content normalization', () => {
  it('keeps the reported article heading and three body paragraphs separate', () => {
    const source = `Are teenagers growing dimmer?&#x20;
Every three years the OECD, a club mostly of rich countries, releases the results of international school tests sat by 15-year-olds all across the world.  There were reasons to hope that the latest data, published on September 8th,  would bring positive news.  Marks in mathematics, reading and science had collapsed in the previous round of testing,  which was carried out just after the pandemic.  Policymakers dared hope that, with the calamity well in the past, grades might start to rebound.&#x20;
That is not what happened.  On the contrary, in rich countries—the primary focus of the tests—scores have fallen further.  In literacy, the decline is actually speeding up.  These data suggest that there are long-running factors pushing down achievement in schools,  and that without swift correction, pupils' abilities could yet plumb further depths.  Anyone who cares about the young of today—and the economies of tomorrow—ought to be alarmed.&#x20;
The OECD's project, known as PISA, takes a measure of young people's aptitudes as they approach the end of their compulsory school days.  The number of school systems taking part has expanded over the years: the latest tests were sat in all 38 OECD member-countries and in 53 other places (many of them developing economies).  The results are used to create an international league table of sorts. `;
    const normalized = normalizePastedContent(source);
    expect(normalized.title).toBe('Are teenagers growing dimmer?');
    expect(normalized.paragraphs).toEqual(
      source.split('\n').map((line) => line.replaceAll('&#x20;', ' ').replace(/\s+/gu, ' ').trim()),
    );
    expect(normalized.paragraphs).toHaveLength(4);
    expect(normalized.contentHash).toBe(normalizePastedContent(source.replaceAll('&#x20;', ' ')).contentHash);
  });

  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])('preserves pasted paragraphs separated by %j', (separator) => {
    const normalized = normalizePastedContent(
      ['Are teenagers growing dimmer?&#x20;', FIRST_PARAGRAPH, '', `${SECOND_PARAGRAPH}&nbsp;`].join(separator),
    );
    expect(normalized.title).toBe('Are teenagers growing dimmer?');
    expect(normalized.paragraphs).toEqual([
      'Are teenagers growing dimmer?', FIRST_PARAGRAPH, SECOND_PARAGRAPH,
    ]);
    expect(normalized.text).toBe(normalized.paragraphs.join('\n\n'));
    expect(normalizeImportContent(normalized)).toEqual(normalized);
  });

  it('continues joining visual line wraps in extracted documents', () => {
    const normalized = normalizeImportContent({
      title: null,
      text: `${FIRST_PARAGRAPH}\n${SECOND_PARAGRAPH}`,
    });
    expect(normalized.paragraphs).toEqual([`${FIRST_PARAGRAPH} ${SECOND_PARAGRAPH}`]);
  });

  it('normalizes title, paragraphs, line endings, and stable identities', () => {
    const normalized = normalizeImportContent({
      title: '  Ａ careful study  ',
      text: SYNTHETIC_PROSE,
    });
    const replay = normalizeImportContent({
      title: 'A careful study',
      text: `${FIRST_PARAGRAPH}\n\n\n${SECOND_PARAGRAPH}`,
    });

    expect(normalized.title).toBe('A careful study');
    expect(normalized.paragraphs).toEqual([
      FIRST_PARAGRAPH,
      SECOND_PARAGRAPH,
    ]);
    expect(normalized.text).toBe(normalized.paragraphs.join('\n\n'));
    expect(normalized.wordCount).toBeGreaterThanOrEqual(20);
    expect(normalized.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(normalized.contentHash).toBe(replay.contentHash);
    expect(normalized.similarityFingerprint).toBe(
      replay.similarityFingerprint,
    );
    expect(BigInt.asIntN(64, normalized.similarityFingerprint)).toBe(
      normalized.similarityFingerprint,
    );
  });

  it('counts straight and curly apostrophes as one English word', () => {
    expect(countEnglishWords("reader's reader’s evidence")).toBe(3);
  });

  it('uses a bounded first-paragraph title fallback', () => {
    const normalized = normalizeImportContent({
      title: null,
      text: SYNTHETIC_PROSE,
    });
    expect(normalized.title).toBe(FIRST_PARAGRAPH);
    expect(Array.from(normalized.title)).toHaveLength(FIRST_PARAGRAPH.length);
  });

  it('rejects invalid controls and non-English content', () => {
    expect(() =>
      normalizeImportContent({
        title: null,
        text: `\u0000\u0001\u0002\u0003${SYNTHETIC_PROSE}`,
      }),
    ).toThrowError(expect.objectContaining({ code: 'IMPORT_CONTENT_INVALID' }));
    expect(() =>
      normalizeImportContent({
        title: null,
        text: `${'这是用于语言检测的原创中文句子。'.repeat(30)} ${'evidence '.repeat(20)}`,
      }),
    ).toThrowError(expect.objectContaining({ code: 'IMPORT_NOT_ENGLISH' }));
  });

  it('enforces exact 20 and 5,000 English-word boundaries', () => {
    expect(
      normalizeImportContent({
        title: null,
        text: englishWords(20),
      }).wordCount,
    ).toBe(20);
    expect(() =>
      normalizeImportContent({
        title: null,
        text: englishWords(19),
      }),
    ).toThrowError(expect.objectContaining({ code: 'IMPORT_CONTENT_INVALID' }));
    expect(
      normalizeImportContent({
        title: null,
        text: englishWords(5_000),
      }).wordCount,
    ).toBe(5_000);
    expect(() =>
      normalizeImportContent({
        title: null,
        text: englishWords(5_001),
      }),
    ).toThrowError(expect.objectContaining({ code: 'IMPORT_CONTENT_INVALID' }));
  });

  it('calculates signed 64-bit Hamming distance and similarity thresholds', () => {
    expect(hammingDistance64(0n, 7n)).toBe(3);
    expect(hammingDistance64(-1n, 0n)).toBe(64);
    expect(
      isSimilarContent(
        { fingerprint: 0n, wordCount: 100 },
        { fingerprint: 7n, wordCount: 125 },
      ),
    ).toBe(true);
    expect(
      isSimilarContent(
        { fingerprint: 0n, wordCount: 100 },
        { fingerprint: 15n, wordCount: 100 },
      ),
    ).toBe(false);
    expect(
      isSimilarContent(
        { fingerprint: 0n, wordCount: 100 },
        { fingerprint: 7n, wordCount: 126 },
      ),
    ).toBe(false);
  });
});
