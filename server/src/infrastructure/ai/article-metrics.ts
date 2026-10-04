// Deterministic text measurements shared by the generation prompts and the validator.
// Counting is done in code because language models count words, gaps and sentence
// lengths unreliably.

const WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/gu;

export function countEnglishWords(text: string): number {
  return text.match(WORD_PATTERN)?.length ?? 0;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc', 'ltd', 'co',
  'no', 'fig', 'e.g', 'i.e', 'u.s', 'u.k', 'a.m', 'p.m',
]);

/** Split a paragraph into sentences without breaking on common abbreviations. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?]+["'”’)\]]*(?=\s+)/gu)) {
    const end = (match.index ?? 0) + match[0].length;
    const next = text.slice(end).match(/^\s+(\S)/u)?.[1];
    // A sentence ends only when the next one starts like a sentence.
    if (next === undefined || !/[A-Z0-9"“'‘([]/u.test(next)) continue;
    const previousWord = text.slice(start, match.index).match(/([A-Za-z.]+)$/u)?.[1]?.toLowerCase().replace(/\.$/u, '');
    if (previousWord !== undefined && (ABBREVIATIONS.has(previousWord) || /^[a-z]$/u.test(previousWord))) continue;
    sentences.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** The sentence of a paragraph that contains the character offset. */
export function sentenceContaining(text: string, offset: number): string | null {
  let cursor = 0;
  for (const sentence of splitSentences(text)) {
    const index = text.indexOf(sentence, cursor);
    if (index === -1) continue;
    if (offset >= index && offset < index + sentence.length) return sentence;
    cursor = index + sentence.length;
  }
  return null;
}

export type ArticleLength = 'long' | 'short';

export const ARTICLE_WORD_RANGE: Record<ArticleLength, { min: number; max: number; aim: number }> = {
  short: { min: 200, max: 300, aim: 250 },
  long: { min: 700, max: 1_000, aim: 840 },
};

/** Longest stretch of English words without a target that the prompts ask for. */
export function targetGapGuidance(targetCount: number, length: ArticleLength): number {
  return Math.max(35, Math.ceil((length === 'short' ? 230 : 945) / (targetCount + 1) * 1.5));
}

/** A "complex sentence" is requested at 30-45 words; trimming never cuts one of 24 or more. */
export const MIN_COMPLEX_SENTENCE_WORDS = 24;
