import type { ArticleSegment } from '@context-reader/contracts';

import { AppError } from '../../core/errors';
import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';

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
  optionsEn: string[];
  correctOptionIndex: number;
  meaningEn: string;
  explanationZh: string;
  optionExplanationsZh: string[];
  optionExplanationsEn: string[];
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
  length: 'long' | 'short' = 'long',
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
  const minWords = length === 'short' ? 200 : 700;
  const maxWords = length === 'short' ? 300 : 1_000;
  if (wordCount < minWords || wordCount > maxWords) {
    throw invalidOutput(`Article has ${wordCount} English words; rewrite it to contain ${minWords}-${maxWords} words, preserving all targets and their meanings.`);
  }

  const usages = targets.map((target) => {
    const usage = usageByAlias.get(target.alias)!;
    const paragraph = paragraphsByKey.get(usage.paragraphKey);
    if (!paragraph) throw invalidOutput('Each usage.paragraphKey must reference an existing paragraph key.');
    const [startOffset] = findCaseInsensitiveOccurrences(
      paragraph.text,
      usage.surfaceForm,
    );
    if (startOffset === undefined) throw invalidOutput('Each usage.surfaceForm must occur verbatim in its referenced paragraph.');
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
    const normalizedOptions = question.optionsEn.map((option) => option.trim().toLowerCase());
    const englishFields = [question.prompt, ...question.optionsEn, question.meaningEn,
      ...question.optionExplanationsEn];
    if (question.optionsEn.length !== 4
      || new Set(normalizedOptions).size !== 4
      || englishFields.some((text) => !/[a-z]/i.test(text) || /\p{Script=Han}/u.test(text))
      || (question.prompt.match(/_{2,}/g) ?? []).length !== 1
      || question.prompt.match(/_{2,}/g)?.[0] !== '____'
      || !Number.isInteger(question.correctOptionIndex)
      || question.correctOptionIndex < 0 || question.correctOptionIndex > 3) {
      throw invalidOutput('Each question needs four distinct English options, English-only text, exactly one ____ blank, and a correctOptionIndex from 0 to 3.');
    }
    if (question.optionExplanationsEn.length !== 4
      || question.optionExplanationsZh.length !== 4
      || [question.explanationZh, ...question.optionExplanationsZh].some((text) => !/\p{Script=Han}/u.test(text))
      || /[a-z]/i.test(question.explanationZh)) {
      throw invalidOutput('Provide four Chinese optionExplanationsZh aligned with optionExplanationsEn and an entirely Chinese explanationZh summary without English words.');
    }
    const answer = question.optionsEn[question.correctOptionIndex]!.trim();
    const promptWords = ` ${question.prompt.toLowerCase().replace(/[^a-z'-]+/g, ' ')} `;
    if (promptWords.includes(` ${answer.toLowerCase()} `)) throw invalidOutput('A question prompt must not reveal its correct answer outside the blank.');
    const completedSentence = question.prompt.replace('____', answer).toLowerCase();
    if (generated.paragraphs.some((paragraph) => paragraph.text.toLowerCase().includes(completedSentence))) {
      throw invalidOutput('Write a new context for each question; do not copy a sentence from the article.');
    }

    return {
      targetId: target.id,
      targetAlias: target.alias,
      prompt: question.prompt,
      optionsEn: question.optionsEn,
      correctOptionIndex: question.correctOptionIndex,
      meaningEn: question.meaningEn,
      explanationZh: question.explanationZh,
      optionExplanationsZh: question.optionExplanationsZh,
      optionExplanationsEn: question.optionExplanationsEn,
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
    if (result.has(paragraph.key)) throw invalidOutput('Paragraph keys must be unique.');
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
  if (items.length !== targetsByAlias.size) throw invalidOutput('Return exactly one usage and one question for every supplied target alias.');
  const result = new Map<string, T>();
  for (const item of items) {
    const alias = aliasOf(item);
    if (!targetsByAlias.has(alias) || result.has(alias)) throw invalidOutput('Use every supplied target alias exactly once in usages and exactly once in questions, without extra aliases.');
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
    if (offsets.length > 1) throw invalidOutput('Each usage.surfaceForm must occur only once in its referenced paragraph; avoid repeated or ambiguous matches.');
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
        throw invalidOutput('Target surface forms must identify separate, non-overlapping spans in the article.');
      }
    }
  }
}

function countEnglishWords(text: string): number {
  return text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu)?.length ?? 0;
}

export class PracticeValidationError extends AppError {
  constructor(public readonly repairIssue: string) {
    super('AI_INVALID_OUTPUT', '生成内容未通过结构检查', 502, true);
  }
}

function invalidOutput(repairIssue = 'Check the artifact against all required article, usage and question constraints.'): AppError {
  return new PracticeValidationError(repairIssue);
}
