import { createHash } from 'node:crypto';

import { franc } from 'franc-min';

import { AppError } from '../../core/errors';

const ENGLISH_WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/gu;
// Import sanitation intentionally targets non-printing control characters.
const DISALLOWED_CONTROL =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const LETTER = /\p{L}/gu;
const LATIN_LETTER = /\p{Script=Latin}/gu;

export interface NormalizedImportContent {
  title: string;
  text: string;
  paragraphs: string[];
  wordCount: number;
  contentHash: string;
  similarityFingerprint: bigint;
}

export interface SimilarityIdentity {
  fingerprint: bigint;
  wordCount: number;
}

export function countEnglishWords(value: string): number {
  return value.match(ENGLISH_WORD)?.length ?? 0;
}

export function normalizePastedContent(text: string): NormalizedImportContent {
  // Clipboard paragraphs often use a single newline. Extracted documents can
  // use those for visual wrapping, so preserve this distinction at ingestion.
  const paragraphs = text
    .replace(/&(?:#x0*(?:20|a0)|#0*(?:32|160)|nbsp);/giu, ' ')
    .replace(/\r\n?|[\u2028\u2029]/gu, '\n')
    .split('\n')
    .join('\n\n');
  return normalizeImportContent({ title: null, text: paragraphs });
}

export function normalizeImportContent(input: {
  title: string | null;
  text: string;
}): NormalizedImportContent {
  const canonical = input.text.normalize('NFKC').replace(/\r\n?/gu, '\n');
  const invalidCount =
    (canonical.match(DISALLOWED_CONTROL)?.length ?? 0) +
    (canonical.match(/\ufffd/gu)?.length ?? 0);
  const characterCount = Math.max(1, Array.from(canonical).length);
  if (invalidCount / characterCount >= 0.02) {
    throw invalidContent('文本包含过多无效字符');
  }

  const withoutControls = canonical.replace(DISALLOWED_CONTROL, '');
  const paragraphs = withoutControls
    .split(/\n\s*\n/gu)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.replace(/\s+/gu, ' ').trim())
        .filter(Boolean)
        .join(' ')
        .trim(),
    )
    .filter(Boolean);
  if (paragraphs.length === 0) {
    throw invalidContent('未找到可导入的正文');
  }

  const text = paragraphs.join('\n\n');
  const wordCount = countEnglishWords(text);
  if (wordCount < 20) {
    throw invalidContent('英文正文至少需要 20 个词');
  }
  if (wordCount > 5_000) {
    throw invalidContent('英文正文不能超过 5,000 词');
  }
  assertEnglish(text);

  const proposedTitle = normalizeTitle(input.title);
  const fallbackTitle = Array.from(paragraphs[0]!)
    .slice(0, 160)
    .join('')
    .trim();
  const title = proposedTitle ?? (fallbackTitle || '导入文章');
  const contentHash = createHash('sha256').update(text, 'utf8').digest('hex');
  const similarityFingerprint = simHash64(text);
  return {
    title,
    text,
    paragraphs,
    wordCount,
    contentHash,
    similarityFingerprint,
  };
}

export function hammingDistance64(left: bigint, right: bigint): number {
  let difference = BigInt.asUintN(64, left) ^ BigInt.asUintN(64, right);
  let count = 0;
  while (difference !== 0n) {
    difference &= difference - 1n;
    count += 1;
  }
  return count;
}

export function isSimilarContent(
  left: SimilarityIdentity,
  right: SimilarityIdentity,
): boolean {
  const ratio = left.wordCount / right.wordCount;
  return (
    ratio >= 0.8 &&
    ratio <= 1.25 &&
    hammingDistance64(left.fingerprint, right.fingerprint) <= 3
  );
}

function normalizeTitle(value: string | null): string | null {
  if (value === null) return null;
  const title = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return title.length > 0 && Array.from(title).length <= 160 ? title : null;
}

function assertEnglish(text: string): void {
  if (Array.from(text).length >= 100) {
    const language = franc(text, { minLength: 20 });
    if (language === 'eng') {
      return;
    }
    if (language !== 'und') {
      throw new AppError('IMPORT_NOT_ENGLISH', '只能导入英文文章', 422);
    }
  }

  const letters = text.match(LETTER) ?? [];
  const latin = text.match(LATIN_LETTER) ?? [];
  if (letters.length === 0 || latin.length / letters.length < 0.8) {
    throw new AppError('IMPORT_NOT_ENGLISH', '只能导入英文文章', 422);
  }
}

function simHash64(text: string): bigint {
  const words = text.toLocaleLowerCase('en-US').match(ENGLISH_WORD) ?? [];
  const shingles =
    words.length < 3
      ? [words.join(' ')]
      : Array.from({ length: words.length - 2 }, (_, index) =>
          words.slice(index, index + 3).join(' '),
        );
  const weights = Array.from({ length: 64 }, () => 0);
  for (const shingle of shingles) {
    const digest = createHash('sha256').update(shingle, 'utf8').digest();
    const value = digest.readBigUInt64BE(0);
    for (let bit = 0; bit < 64; bit += 1) {
      weights[bit] =
        weights[bit]! + ((value & (1n << BigInt(bit))) === 0n ? -1 : 1);
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if (weights[bit]! >= 0) {
      fingerprint |= 1n << BigInt(bit);
    }
  }
  return BigInt.asIntN(64, fingerprint);
}

function invalidContent(message: string): AppError {
  return new AppError('IMPORT_CONTENT_INVALID', message, 422);
}
