import type { ArticleSegment } from '@context-reader/contracts';

import { AppError } from '../../core/errors';
import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';
import { normalizeMeaningZh } from '../vocabulary/normalize';

export interface GenerationTarget {
  id: string;
  alias: string;
  meaningZh: string;
}

export interface ValidatedUsage {
  targetId: string;
  targetAlias: string;
  paragraphKey: string;
  paragraphIndex: number;
  surfaceForm: string;
  startOffset: number;
  endOffset: number;
}

export interface ValidatedQuestion {
  targetId: string;
  targetAlias: string;
  prompt: string;
  optionsZh: string[];
  correctOptionIndex: number;
  meaningEn: string;
  explanationZh: string;
  optionExplanationsZh: string[];
}

export interface ValidatedGeneratedPractice {
  title: string;
  wordCount: number;
  paragraphs: GeneratedPractice['paragraphs'];
  usages: ValidatedUsage[];
  questions: ValidatedQuestion[];
}

export interface TargetRange {
  id: string;
  startOffset: number;
  endOffset: number;
}

export function validateGeneratedPractice(
  generated: GeneratedPractice,
  targets: readonly GenerationTarget[],
): ValidatedGeneratedPractice {
  const paragraphsByKey = indexParagraphs(generated.paragraphs);
  const targetsByAlias = indexTargets(targets);
  const usageByAlias = indexExactAliases(
    generated.usages,
    targetsByAlias,
    (usage) => usage.targetAlias,
  );
  const questionByAlias = indexExactAliases(
    generated.questions,
    targetsByAlias,
    (question) => question.targetAlias,
  );
  const wordCount = countEnglishWords(
    generated.paragraphs.map((paragraph) => paragraph.text).join(' '),
  );
  if (wordCount < 700 || wordCount > 1_000) throw invalidOutput();

  const usages = targets.map((target) => {
    const usage = usageByAlias.get(target.alias)!;
    const paragraph = paragraphsByKey.get(usage.paragraphKey);
    if (!paragraph) throw invalidOutput();
    const [startOffset] = findCaseInsensitiveOccurrences(
      paragraph.text,
      usage.surfaceForm,
    );
    if (startOffset === undefined) throw invalidOutput();
    const endOffset = startOffset + usage.surfaceForm.length;
    return {
      targetId: target.id,
      targetAlias: target.alias,
      paragraphKey: paragraph.key,
      paragraphIndex: paragraph.index,
      surfaceForm: paragraph.text.slice(startOffset, endOffset),
      startOffset,
      endOffset,
    };
  });
  assertNonOverlappingUsages(usages);

  const questions = targets.map((target) => {
    const question = questionByAlias.get(target.alias)!;
    const normalizedOptions = question.optionsZh.map(normalizeMeaningZh);
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      throw invalidOutput();
    }
    const normalizedMeaning = normalizeMeaningZh(target.meaningZh);
    const matchingIndexes = normalizedOptions.flatMap((option, index) =>
      option === normalizedMeaning ? [index] : [],
    );
    if (matchingIndexes.length !== 1) throw invalidOutput();

    return {
      targetId: target.id,
      targetAlias: target.alias,
      prompt: question.prompt,
      optionsZh: question.optionsZh,
      correctOptionIndex: matchingIndexes[0]!,
      meaningEn: question.meaningEn,
      explanationZh: question.explanationZh,
      optionExplanationsZh: question.optionExplanationsZh,
    };
  });

  return {
    title: generated.title,
    wordCount,
    paragraphs: generated.paragraphs,
    usages,
    questions,
  };
}

export function segmentParagraph(
  text: string,
  targets: readonly TargetRange[],
): ArticleSegment[] {
  const sorted = [...targets].sort(
    (left, right) => left.startOffset - right.startOffset,
  );
  const result: ArticleSegment[] = [];
  let cursor = 0;

  for (const target of sorted) {
    if (
      !Number.isInteger(target.startOffset) ||
      !Number.isInteger(target.endOffset) ||
      target.startOffset < cursor ||
      target.endOffset <= target.startOffset ||
      target.endOffset > text.length
    ) {
      throw invalidOutput();
    }
    if (cursor < target.startOffset) {
      result.push({ text: text.slice(cursor, target.startOffset), targetId: null });
    }
    result.push({
      text: text.slice(target.startOffset, target.endOffset),
      targetId: target.id,
    });
    cursor = target.endOffset;
  }
  if (cursor < text.length) {
    result.push({ text: text.slice(cursor), targetId: null });
  }
  if (result.length === 0) result.push({ text, targetId: null });
  return result;
}

function indexParagraphs(paragraphs: GeneratedPractice['paragraphs']) {
  const result = new Map<string, { key: string; text: string; index: number }>();
  paragraphs.forEach((paragraph, index) => {
    if (result.has(paragraph.key)) throw invalidOutput();
    result.set(paragraph.key, { ...paragraph, index });
  });
  return result;
}

function indexTargets(targets: readonly GenerationTarget[]) {
  const result = new Map<string, GenerationTarget>();
  for (const target of targets) {
    if (result.has(target.alias)) throw invalidOutput();
    result.set(target.alias, target);
  }
  return result;
}

function indexExactAliases<T>(
  items: readonly T[],
  targetsByAlias: ReadonlyMap<string, GenerationTarget>,
  aliasOf: (item: T) => string,
): Map<string, T> {
  if (items.length !== targetsByAlias.size) throw invalidOutput();
  const result = new Map<string, T>();
  for (const item of items) {
    const alias = aliasOf(item);
    if (!targetsByAlias.has(alias) || result.has(alias)) throw invalidOutput();
    result.set(alias, item);
  }
  return result;
}

function findCaseInsensitiveOccurrences(text: string, surface: string): number[] {
  const normalizedText = text.toLocaleLowerCase('en-US');
  const normalizedSurface = surface.toLocaleLowerCase('en-US');
  const offsets: number[] = [];
  let cursor = 0;

  while (cursor <= normalizedText.length - normalizedSurface.length) {
    const offset = normalizedText.indexOf(normalizedSurface, cursor);
    if (offset === -1) break;
    offsets.push(offset);
    if (offsets.length > 1) throw invalidOutput();
    cursor = offset + Math.max(1, normalizedSurface.length);
  }
  return offsets;
}

function assertNonOverlappingUsages(usages: readonly ValidatedUsage[]): void {
  const byParagraph = new Map<string, ValidatedUsage[]>();
  for (const usage of usages) {
    const paragraphUsages = byParagraph.get(usage.paragraphKey) ?? [];
    paragraphUsages.push(usage);
    byParagraph.set(usage.paragraphKey, paragraphUsages);
  }
  for (const paragraphUsages of byParagraph.values()) {
    const sorted = [...paragraphUsages].sort(
      (left, right) => left.startOffset - right.startOffset,
    );
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index]!.startOffset < sorted[index - 1]!.endOffset) {
        throw invalidOutput();
      }
    }
  }
}

function countEnglishWords(text: string): number {
  return text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu)?.length ?? 0;
}

function invalidOutput(): AppError {
  return new AppError('AI_INVALID_OUTPUT', '生成内容未通过结构检查', 502, true);
}
