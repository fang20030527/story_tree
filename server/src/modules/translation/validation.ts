import { createHash } from 'node:crypto';
import { z } from 'zod';

import { AppError } from '../../core/errors';

const TranslationEnvelopeSchema = z.union([
  z.object({ sourceText: z.string() }).strict(),
  z.object({ translatedTextZh: z.string() }).strict(),
]);

export function validateTranslationText(text: string, sourceText?: string): string {
  let trimmed = text.trim();
  const fenced = /^```(?:json|text)?\s*\n([\s\S]*?)\n```$/iu.exec(trimmed);
  if (fenced) trimmed = fenced[1]!.trim();

  // Some models mirror the sourceText input envelope instead of returning prose.
  // Only unwrap recognized, unambiguous shapes; never display raw structured data.
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw invalidTranslation();
    }
    if (typeof value === 'string') {
      trimmed = value.trim();
    } else {
      const parsed = TranslationEnvelopeSchema.safeParse(value);
      if (!parsed.success) throw invalidTranslation();
      trimmed = ('sourceText' in parsed.data
        ? parsed.data.sourceText
        : parsed.data.translatedTextZh).trim();
    }
  }
  if (!trimmed || !/\p{Script=Han}/u.test(trimmed)
    || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```')) {
    throw invalidTranslation();
  }
  if (sourceText) {
    const normalizedSource = normalizeEchoText(sourceText);
    const normalizedTranslation = normalizeEchoText(trimmed);
    const shortSourceEchoes = new Set([
      normalizedSource,
      `译文${normalizedSource}`,
      `翻译${normalizedSource}`,
      `中文译文${normalizedSource}`,
    ]);
    if (normalizedSource && (normalizedSource.length >= 30
      ? normalizedTranslation.includes(normalizedSource)
      : shortSourceEchoes.has(normalizedTranslation))) {
      throw invalidTranslation();
    }
    // Full-article requests contain several paragraphs. A model can prefix each
    // copied English paragraph with "译文：", which defeats a whole-input match.
    const copiedParagraph = sourceText.split(/\n\s*\n/u)
      .map(normalizeEchoText)
      .some((paragraph) => paragraph.length >= 30
        && normalizedTranslation.includes(paragraph));
    if (copiedParagraph) throw invalidTranslation();

    // Also reject predominantly English results if the model changes punctuation
    // or whitespace while echoing the input. Small English names may remain in a
    // valid Chinese translation, so apply this only to substantial English input.
    const sourceLatin = countMatches(sourceText, /[A-Za-z]/gu);
    const translatedLatin = countMatches(trimmed, /[A-Za-z]/gu);
    const translatedHan = countMatches(trimmed, /\p{Script=Han}/gu);
    if (sourceLatin >= 100 && translatedLatin >= sourceLatin * 0.6
      && translatedLatin > translatedHan * 2) {
      throw invalidTranslation();
    }
  }
  return trimmed;
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function normalizeEchoText(value: string): string {
  return value.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

function invalidTranslation(): AppError {
  return new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
}

export function createTranslationSourceHash(
  resourceId: string,
  scope: 'paragraph' | 'full',
  paragraphId: string | null,
  sourceText: string,
): string {
  return createHash('sha256')
    .update(
      `${resourceId}\u0000${scope}\u0000${paragraphId ?? ''}\u0000${sourceText}`,
      'utf8',
    )
    .digest('hex');
}
