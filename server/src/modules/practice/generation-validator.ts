import type { ArticleSegment } from '@context-reader/contracts';

import { AppError } from '../../core/errors';
import {
  ARTICLE_WORD_RANGE,
  MIN_COMPLEX_SENTENCE_WORDS,
  countEnglishWords,
  sentenceContaining,
  splitSentences,
  type ArticleLength,
} from '../../infrastructure/ai/article-metrics';
import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';

export interface GenerationTarget {
  id: string;
  alias: string;
  meaningZh: string;
  /** The vocabulary term. Lets the validator find a target the model mislabelled. */
  term?: string;
  /** Self-test questions planned for this target; one when absent. */
  questionCount?: number;
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
  /** 0 for the first question of the target; later rounds ask the same target in a new sentence. */
  round: number;
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
  /** What was repaired or let through, as short codes (for example `USAGE_RELOCATED:t2`). */
  notes?: string[];
}

export interface ValidationOptions {
  /**
   * On the final draft, finish what the model left out (a target missing from the article,
   * no questions at all) instead of rejecting the draft, so a usable practice is always stored.
   */
  completeMissing?: boolean;
}

export interface TargetRange {
  id: string;
  startOffset: number;
  endOffset: number;
}

interface ParagraphInfo {
  key: string;
  text: string;
  index: number;
}

interface Located {
  paragraph: ParagraphInfo;
  start: number;
  end: number;
}

type RawQuestion = GeneratedPractice['questions'][number];
type RawUsage = GeneratedPractice['usages'][number];

/** Fewer English words than this is no article at all. */
const MIN_ARTICLE_WORDS = 20;
/** More Chinese than this share of the letters means the article is not written in English. */
const MAX_CHINESE_SHARE = 0.3;
const MAX_TRIM_WORDS = 60;
const MAX_TITLE_LENGTH = 160;
const NEUTRAL_DISTRACTORS = ['approach', 'tendency', 'balance', 'measure', 'attitude', 'variety'];

/**
 * Turn a generated practice into the artifact that is stored and read back.
 *
 * Only an article that cannot be used is rejected: no English article text, a target that
 * does not appear in it at all, or no questions at all. Everything else is repaired when code
 * can do it (blank format, answer index, option count, explanations, a slightly long article,
 * a mislabelled usage) and otherwise let through, so the stored practice always meets what
 * the read path and the client contract require. What was repaired is reported in `notes`.
 *
 * A target has one question, or the `questionCount` planned for it. The first is always
 * stored (built from the article when the reply has none). The extra ones are only kept when
 * the reply wrote them as new questions: an extra question that would be a copy or an empty
 * shell is left out rather than invented. Questions come back round by round, so the
 * questions of one target are spread through the self-test.
 */
export function validateGeneratedPractice(
  generated: GeneratedPractice,
  targets: readonly GenerationTarget[],
  length: ArticleLength = 'long',
  options: ValidationOptions = {},
): ValidatedGeneratedPractice {
  const notes: string[] = [];
  const draft = normalizeDraft(generated);
  const targetsByAlias = indexTargets(targets);

  const articleText = draft.paragraphs.map((paragraph) => paragraph.text).join(' ');
  const han = articleText.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = articleText.match(/[A-Za-z]/gu)?.length ?? 0;
  if (han > 0 && han / (han + latin) > MAX_CHINESE_SHARE) {
    throw new PracticeValidationError(
      'The article must be written in English, but most of the text is Chinese. Rewrite the whole article in English.',
      ['ARTICLE_LANGUAGE'],
    );
  }
  const words = countEnglishWords(articleText);
  if (draft.paragraphs.length === 0 || words < MIN_ARTICLE_WORDS) {
    throw new PracticeValidationError(
      `The article is empty or far too short (${words} English words). Return a full English article in the paragraphs.`,
      ['ARTICLE_EMPTY'],
    );
  }

  const usageByAlias = firstByAlias(draft.usages, targetsByAlias);
  const questionsByAlias = groupQuestions(draft.questions, targetsByAlias);

  let paragraphs = draft.paragraphs;
  let wordCount = words;
  const range = ARTICLE_WORD_RANGE[length];
  if (wordCount > range.max) {
    const protectedSurfaces = [...usageByAlias.values()].map((usage) => usage.surfaceForm.toLowerCase()).filter(Boolean);
    const matchers = targets.flatMap((target) => (target.term ? [termMatcher(target.term, 'i')] : []));
    const trimmed = trimOverlong(
      paragraphs,
      (sentence) => {
        const lower = sentence.toLowerCase();
        return protectedSurfaces.some((surface) => lower.includes(surface)) || matchers.some((matcher) => matcher.test(sentence));
      },
      wordCount - range.max,
      range.min,
    );
    if (trimmed) {
      paragraphs = trimmed;
      wordCount = totalWords(paragraphs);
      notes.push('TRIMMED');
    }
  }
  if (wordCount < range.min || wordCount > range.max) {
    notes.push(`WORD_COUNT_${wordCount < range.min ? 'LOW' : 'HIGH'}:${wordCount}`);
  }

  let infos = paragraphs.map((paragraph, index) => ({ ...paragraph, index }));
  const placed = new Map<string, Located>();
  const missing: GenerationTarget[] = [];
  const assigned: Located[] = [];
  const formsByAlias = new Map(targets.map((target) => [target.alias, new Set(target.term ? termForms(target.term) : [])]));
  for (const target of targets) {
    const usage = usageByAlias.get(target.alias);
    const candidates = candidatesFor(target, usage, infos);
    // A word that is another target's own term belongs to that target, even if the model
    // labelled this usage with it.
    const ownedByAnother = (candidate: Located) => {
      const word = bareWord(candidate.paragraph.text.slice(candidate.start, candidate.end));
      if (formsByAlias.get(target.alias)!.has(word)) return false;
      return targets.some((other) => other !== target && formsByAlias.get(other.alias)!.has(word));
    };
    const chosen = candidates.find((candidate) => !ownedByAnother(candidate) && !assigned.some((other) => overlaps(other, candidate)));
    if (!chosen) {
      missing.push(target);
      continue;
    }
    assigned.push(chosen);
    placed.set(target.alias, chosen);
    if (!reportedLocation(usage, chosen)) notes.push(`USAGE_RELOCATED:${target.alias}`);
  }

  // Only the final draft is completed by code; earlier drafts go back to the model with the
  // problem named, because a rewrite gives a better article than a patched one.
  const problems: Array<{ code: string; message: string }> = [];
  if (missing.length > 0 && (!options.completeMissing || missing.some((target) => !target.term))) {
    problems.push({
      code: 'TARGET_MISSING',
      message: `These targets do not appear in the article: ${missing.map(describe).join(', ')}. Use every target in the article exactly as written in its surfaceForm, and keep a usage and a question for each.`,
    });
  }
  if (questionsByAlias.size === 0 && targets.length > 0 && !options.completeMissing) {
    problems.push({
      code: 'QUESTIONS_MISSING',
      message: 'The artifact has no questions. Return one fill-in-the-blank question for every target, in the questions array.',
    });
  }
  if (problems.length > 0) {
    throw new PracticeValidationError(problems.map((problem) => problem.message), problems.map((problem) => problem.code));
  }
  if (missing.length > 0) {
    for (const target of missing) {
      const last = infos.at(-1)!;
      const prefix = `${last.text} One expression worth remembering here is "`;
      const text = `${prefix}${target.term}".`;
      infos = infos.map((info) => (info.index === last.index ? { ...info, text } : info));
      const injected = { paragraph: infos[last.index]!, start: prefix.length, end: prefix.length + target.term!.length };
      placed.set(target.alias, injected);
      notes.push(`TARGET_ADDED:${target.alias}`);
    }
    paragraphs = infos.map(({ key, text }) => ({ key, text }));
    wordCount = totalWords(paragraphs);
  }

  // Later injections extend the last paragraph, so read the final text of each paragraph.
  const finalText = (located: Located) => infos[located.paragraph.index]!.text;
  const surfaces = new Map(targets.map((target) => {
    const located = placed.get(target.alias)!;
    return [target.alias, finalText(located).slice(located.start, located.end)] as const;
  }));
  const usages = targets.map((target) => {
    const located = placed.get(target.alias)!;
    const paragraph = infos[located.paragraph.index]!;
    return {
      targetId: target.id,
      targetAlias: target.alias,
      paragraphKey: paragraph.key,
      paragraphIndex: paragraph.index,
      surfaceForm: surfaces.get(target.alias)!,
      startOffset: located.start,
      endOffset: located.end,
    };
  });
  const questions: ValidatedQuestion[] = [];
  const rounds = Math.max(1, ...[...questionsByAlias.values()].map((list) => list.length));
  for (let round = 0; round < rounds; round += 1) {
    targets.forEach((target, position) => {
      const raw = questionsByAlias.get(target.alias)?.[round];
      // Only the first question is ever built; a missing extra one is simply not asked.
      if (round > 0 && raw === undefined) return;
      questions.push({
        ...repairQuestion({
          target,
          position,
          tag: round === 0 ? target.alias : `${target.alias}#${round + 1}`,
          raw,
          located: { ...placed.get(target.alias)!, paragraph: infos[placed.get(target.alias)!.paragraph.index]! },
          surfaces,
          notes,
        }),
        round,
      });
    });
  }
  for (const target of targets) {
    const asked = questionsByAlias.get(target.alias)?.length ?? 1;
    if (asked < plannedQuestions(target)) notes.push(`QUESTIONS_SHORT:${target.alias}:${asked}/${plannedQuestions(target)}`);
  }

  return {
    title: draft.title || deriveTitle(paragraphs),
    wordCount,
    paragraphs,
    usages,
    questions,
    ...(notes.length > 0 ? { notes } : {}),
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
      throw new PracticeValidationError(DEFAULT_REPAIR_ISSUE);
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

const DEFAULT_REPAIR_ISSUE = 'Check the artifact against all required article, usage and question constraints.';

export class PracticeValidationError extends AppError {
  /** Every problem found in the draft, most important first. */
  readonly repairIssues: string[];
  /** Short machine-readable codes for diagnostics; they never contain article text. */
  readonly issueCodes: string[];

  constructor(issues: string | readonly string[], codes: readonly string[] = []) {
    super('AI_INVALID_OUTPUT', '生成内容未通过结构检查', 502, true);
    const list = (typeof issues === 'string' ? [issues] : [...issues]).filter(Boolean);
    this.repairIssues = list.length > 0 ? list : [DEFAULT_REPAIR_ISSUE];
    this.issueCodes = [...codes];
  }

  /** The first (most important) problem. */
  get repairIssue(): string {
    return this.repairIssues[0]!;
  }
}

function describe(target: GenerationTarget): string {
  return target.term ? `${target.alias} ("${target.term}")` : target.alias;
}

function totalWords(paragraphs: ReadonlyArray<{ text: string }>): number {
  return countEnglishWords(paragraphs.map((paragraph) => paragraph.text).join(' '));
}

/** Models sometimes bold a target or the blank; the markers must not reach the stored text. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(?=\S)([^*]+?)(?<=\S)\*\*/gu, '$1')
    .replace(/(?<![*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\w])/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1');
}

const clean = (text: string): string => stripMarkdown(text).trim();

/** A Chinese topic name in the title is cosmetic: drop it rather than reject the draft. */
function englishTitle(title: string): string {
  if (!/\p{Script=Han}/u.test(title)) return title;
  const cleaned = title
    .replace(/\p{Script=Han}+/gu, ' ')
    .replace(/[（(]\s*[）)]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s:：,，;；\-–—|·]+|[\s:：,，;；\-–—|·]+$/gu, '');
  return cleaned || title;
}

/** A title is required by the client; without one, the opening words of the article will do. */
function deriveTitle(paragraphs: ReadonlyArray<{ text: string }>): string {
  const opening = splitSentences(paragraphs[0]?.text ?? '')[0] ?? '';
  const title = opening.split(/\s+/u).slice(0, 8).join(' ').replace(/[\s,;:.!?\-–—]+$/u, '');
  return title || 'Untitled essay';
}

/** "resilient." and "(resilient)" mean the word itself; keep inner hyphens and apostrophes. */
function bareSurface(surface: string): string {
  return surface.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/gu, '') || surface;
}

interface Draft {
  title: string;
  paragraphs: Array<{ key: string; text: string }>;
  usages: RawUsage[];
  questions: RawQuestion[];
}

/** Deterministic clean-up that never changes the meaning of the content. */
function normalizeDraft(generated: GeneratedPractice): Draft {
  const used = new Set<string>();
  const paragraphs = generated.paragraphs
    .map((paragraph) => ({ key: paragraph.key.trim(), text: clean(paragraph.text).replace(/\s+/gu, ' ') }))
    .filter((paragraph) => paragraph.text !== '')
    .map((paragraph, index) => {
      // Keys name paragraphs in the stored rows, so each one must exist and be unique.
      let key = paragraph.key && !used.has(paragraph.key) ? paragraph.key : `p${index + 1}`;
      while (used.has(key)) key += '_';
      used.add(key);
      return { key, text: paragraph.text };
    });
  const keyFor = (raw: string): string => {
    const key = raw.trim();
    if (paragraphs.some((paragraph) => paragraph.key === key)) return key;
    const caseless = paragraphs.find((paragraph) => paragraph.key.toLowerCase() === key.toLowerCase());
    if (caseless) return caseless.key;
    const digits = key.toLowerCase().match(/^(?:p|para|paragraph)?[\s_-]*#?(\d+)$/u)?.[1];
    const numbered = digits === undefined ? undefined : `p${Number(digits)}`;
    return numbered !== undefined && paragraphs.some((paragraph) => paragraph.key === numbered) ? numbered : key;
  };
  return {
    title: englishTitle(clean(generated.title)).slice(0, MAX_TITLE_LENGTH),
    paragraphs,
    usages: generated.usages.map((usage) => ({
      targetAlias: usage.targetAlias.trim().toLowerCase(),
      paragraphKey: keyFor(usage.paragraphKey),
      surfaceForm: bareSurface(clean(usage.surfaceForm)),
    })),
    questions: generated.questions.map((question) => ({
      ...question,
      targetAlias: question.targetAlias.trim().toLowerCase(),
      // Models write two to six underscores; the stored contract is exactly four.
      prompt: clean(question.prompt).replace(/_{2,}/gu, '____'),
      // The option lists keep their positions: explanations are matched to options by index.
      optionsEn: question.optionsEn.map(clean),
      meaningEn: clean(question.meaningEn),
      explanationZh: clean(question.explanationZh),
      optionExplanationsZh: question.optionExplanationsZh.map(clean),
      optionExplanationsEn: question.optionExplanationsEn.map(clean),
    })),
  };
}

function indexTargets(targets: readonly GenerationTarget[]) {
  const result = new Map<string, GenerationTarget>();
  for (const target of targets) {
    if (result.has(target.alias)) throw new PracticeValidationError(DEFAULT_REPAIR_ISSUE);
    result.set(target.alias, target);
  }
  return result;
}

/** One entry per known alias: the first wins, duplicates and unknown aliases are ignored. */
function firstByAlias<T extends { targetAlias: string }>(
  items: readonly T[],
  targetsByAlias: ReadonlyMap<string, GenerationTarget>,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (targetsByAlias.has(item.targetAlias) && !result.has(item.targetAlias)) result.set(item.targetAlias, item);
  }
  return result;
}

const plannedQuestions = (target: GenerationTarget): number => Math.max(1, Math.floor(target.questionCount ?? 1));

/** Two prompts are the same question when only case, spacing and the length of the blank differ. */
const samePrompt = (left: string, right: string): boolean => {
  const key = (prompt: string) => prompt.toLowerCase().replace(/[\s_]+/gu, ' ').trim();
  return key(left) === key(right);
};

/**
 * The questions the reply holds for each known alias, in the order written, up to the number
 * planned for the target. Unknown aliases are ignored. After a target's first question, one
 * that has no prompt or repeats an earlier prompt of the same target is dropped: an extra
 * question is only worth asking when it is a new one.
 */
function groupQuestions(
  items: readonly RawQuestion[],
  targetsByAlias: ReadonlyMap<string, GenerationTarget>,
): Map<string, RawQuestion[]> {
  const result = new Map<string, RawQuestion[]>();
  for (const item of items) {
    const target = targetsByAlias.get(item.targetAlias);
    if (!target) continue;
    const list = result.get(item.targetAlias) ?? [];
    if (list.length >= plannedQuestions(target)) continue;
    // The first question is repaired even when empty; an empty or repeated extra one is worthless.
    if (list.length > 0 && (item.prompt === '' || list.some((earlier) => samePrompt(earlier.prompt, item.prompt)))) continue;
    list.push(item);
    result.set(item.targetAlias, list);
  }
  return result;
}

const REFERS_BACK = /^(?:this|these|those|that|it|they|such|he|she|its|their)\b/iu;

/**
 * A slightly overlong article is shortened by dropping whole filler sentences:
 * never a sentence with a target, the first sentence of a paragraph, the closing
 * sentence, a long complex sentence or one that the next sentence refers back to.
 */
function trimOverlong(
  paragraphs: ReadonlyArray<{ key: string; text: string }>,
  isProtected: (sentence: string) => boolean,
  excess: number,
  minWords: number,
): Array<{ key: string; text: string }> | null {
  if (excess > MAX_TRIM_WORDS) return null;
  const split = paragraphs.map((paragraph) => splitSentences(paragraph.text));
  const total = totalWords(paragraphs);
  interface Candidate { paragraph: number; sentence: number; words: number }
  const candidates: Candidate[] = [];
  split.forEach((sentences, paragraph) => {
    sentences.forEach((sentence, index) => {
      const closing = paragraph === split.length - 1 && index === sentences.length - 1;
      if (index === 0 || closing) return;
      const next = sentences[index + 1];
      if (next !== undefined && REFERS_BACK.test(next)) return;
      const words = countEnglishWords(sentence);
      if (words === 0 || words >= MIN_COMPLEX_SENTENCE_WORDS - 2 || isProtected(sentence)) return;
      candidates.push({ paragraph, sentence: index, words });
    });
  });

  const wordsOf = (group: readonly Candidate[]) => group.reduce((sum, item) => sum + item.words, 0);
  const fits = (group: readonly Candidate[]): boolean => {
    const words = wordsOf(group);
    if (words < excess || total - words < minWords) return false;
    // A paragraph that loses a sentence keeps at least three; the others are not touched.
    return split.every((sentences, paragraph) => {
      const removed = group.filter((item) => item.paragraph === paragraph).length;
      return removed === 0 || sentences.length - removed >= 3;
    });
  };
  // Prefer the smallest removal that fixes the length: one sentence, then two.
  const singles = candidates.map((candidate) => [candidate]);
  const pairs = candidates.flatMap((left, index) =>
    candidates.slice(index + 1).map((right) => [left, right]));
  const best = [singles, pairs]
    .map((groups) => groups.filter(fits).sort((left, right) => wordsOf(left) - wordsOf(right))[0])
    .find((group) => group !== undefined);
  if (!best) return null;
  const removed = new Set(best.map((item) => `${item.paragraph}:${item.sentence}`));
  return paragraphs.map((paragraph, index) => {
    const touched = split[index]!.some((_, sentence) => removed.has(`${index}:${sentence}`));
    if (!touched) return paragraph;
    return {
      key: paragraph.key,
      text: split[index]!.filter((_, sentence) => !removed.has(`${index}:${sentence}`)).join(' '),
    };
  });
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9]/u.test(character);
}

/** A match is a whole word unless letters (or a hyphen/apostrophe joining letters) touch it. */
function isWholeWord(text: string, start: number, end: number): boolean {
  const joins = (edge: string | undefined, beyond: string | undefined) =>
    isWordCharacter(edge) || ((edge === '-' || edge === "'" || edge === '’') && isWordCharacter(beyond));
  return !joins(text[start - 1], text[start - 2]) && !joins(text[end], text[end + 1]);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Spellings of a vocabulary term the article may legitimately contain. */
function termForms(term: string): string[] {
  const base = term.trim().toLowerCase();
  if (!base) return [];
  if (/\s/u.test(base)) return [base];
  const forms = new Set([base, `${base}s`, `${base}es`, `${base}ed`, `${base}d`, `${base}ing`]);
  if (base.length > 2 && base.endsWith('y')) {
    const stem = base.slice(0, -1);
    forms.add(`${stem}ies`);
    forms.add(`${stem}ied`);
  }
  if (base.endsWith('e')) forms.add(`${base.slice(0, -1)}ing`);
  const last = base.at(-1)!;
  if (/[a-z]/u.test(last) && !/[aeiouwxy]/u.test(last)) {
    forms.add(`${base}${last}ed`);
    forms.add(`${base}${last}ing`);
  }
  return [...forms];
}

function termMatcher(term: string, flags: 'gi' | 'i'): RegExp {
  const forms = termForms(term).map((form) => escapeRegExp(form).replace(/\s+/gu, '\\s+'));
  if (forms.length === 0) return /(?!)/u;
  return new RegExp(`(?<![A-Za-z0-9])(?:${forms.join('|')})(?![A-Za-z0-9])`, flags);
}

/** Lower-case that keeps every offset: "İ" would otherwise grow by a character and shift what follows. */
function foldCase(text: string): string {
  const folded = text.toLocaleLowerCase('en-US');
  if (folded.length === text.length) return folded;
  return Array.from(text, (character) => {
    const lower = character.toLocaleLowerCase('en-US');
    return lower.length === character.length ? lower : character;
  }).join('');
}

/** Every place a surface text occurs in a paragraph (case-insensitive), in reading order. */
function surfaceOccurrences(paragraph: ParagraphInfo, surface: string, wholeWordsOnly: boolean): Located[] {
  const text = foldCase(paragraph.text);
  const needle = foldCase(surface);
  if (!needle) return [];
  const found: Located[] = [];
  let cursor = 0;
  while (cursor <= text.length - needle.length) {
    const offset = text.indexOf(needle, cursor);
    if (offset === -1) break;
    if (!wholeWordsOnly || isWholeWord(paragraph.text, offset, offset + needle.length)) {
      found.push({ paragraph, start: offset, end: offset + needle.length });
    }
    cursor = offset + Math.max(1, needle.length);
  }
  return found;
}

function termOccurrences(paragraphs: readonly ParagraphInfo[], term: string): Located[] {
  const matcher = termMatcher(term, 'gi');
  return paragraphs.flatMap((paragraph) => Array.from(paragraph.text.matchAll(matcher), (match) => {
    const start = match.index ?? 0;
    return { paragraph, start, end: start + match[0].length };
  }));
}

/**
 * Where a target may be placed, best first: the word the model reported (in its paragraph,
 * then anywhere), the term or an inflection of it, and last a fragment of a longer word.
 */
function candidatesFor(
  target: GenerationTarget,
  usage: RawUsage | undefined,
  paragraphs: readonly ParagraphInfo[],
): Located[] {
  const surface = usage?.surfaceForm ?? '';
  const hinted = usage ? paragraphs.find((paragraph) => paragraph.key === usage.paragraphKey) : undefined;
  const order = hinted ? [hinted, ...paragraphs.filter((paragraph) => paragraph !== hinted)] : paragraphs;
  const list = [
    ...order.flatMap((paragraph) => surfaceOccurrences(paragraph, surface, true)),
    ...(target.term ? termOccurrences(paragraphs, target.term) : []),
    ...order.flatMap((paragraph) => surfaceOccurrences(paragraph, surface, false)),
  ];
  const seen = new Set<string>();
  return list.filter((candidate) => {
    const id = `${candidate.paragraph.index}:${candidate.start}:${candidate.end}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function overlaps(left: Located, right: Located): boolean {
  return left.paragraph.index === right.paragraph.index && left.start < right.end && right.start < left.end;
}

/** Whether the model's own usage points exactly at this place. */
function reportedLocation(usage: RawUsage | undefined, located: Located): boolean {
  return usage !== undefined
    && usage.paragraphKey === located.paragraph.key
    && located.paragraph.text.slice(located.start, located.end).toLowerCase() === usage.surfaceForm.toLowerCase();
}

const bareWord = (text: string): string => text.trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '');

interface OptionEntry {
  label: string;
  zh: string | undefined;
  en: string | undefined;
  correct: boolean;
}

interface QuestionRepair {
  target: GenerationTarget;
  position: number;
  /** Names the question in `notes`: the alias, or the alias and round for an extra question. */
  tag: string;
  raw: RawQuestion | undefined;
  located: Located;
  surfaces: ReadonlyMap<string, string>;
  notes: string[];
}

/**
 * Make a question valid for storage and for the client contract, whatever the model wrote:
 * exactly four options, the target word as the answer, a blank in the prompt and an
 * explanation for every option. A target without a usable question gets a cloze question
 * built from its own sentence. Wording quality is not judged here.
 */
function repairQuestion({ target, position, tag, raw, located, surfaces, notes }: QuestionRepair): Omit<ValidatedQuestion, 'round'> {
  const surface = surfaces.get(target.alias)!;
  const answerForms = new Set([bareWord(surface), ...(target.term ? termForms(target.term) : [])]);
  const siblings = [...surfaces.entries()].filter(([alias]) => alias !== target.alias).map(([, text]) => text);

  let entries: OptionEntry[] = raw
    ? raw.optionsEn.map((label, index) => ({
      label,
      zh: raw.optionExplanationsZh[index] || undefined,
      en: raw.optionExplanationsEn[index] || undefined,
      correct: false,
    })).filter((entry) => entry.label !== '')
    : [];
  const reportedIndex = raw && Number.isInteger(raw.correctOptionIndex) ? raw.correctOptionIndex : -1;
  const reportedLabel = raw?.optionsEn[reportedIndex];

  // The answer is the target word; trust the model's index only when no option is the target.
  let answer = entries.findIndex((entry) => answerForms.has(bareWord(entry.label)));
  if (answer === -1 && reportedLabel) answer = entries.findIndex((entry) => entry.label === reportedLabel);
  if (answer === -1) {
    entries.push({ label: surface, zh: undefined, en: undefined, correct: true });
    answer = entries.length - 1;
    if (raw) notes.push(`ANSWER_ADDED:${tag}`);
  } else if (reportedLabel !== undefined && entries[answer]!.label !== reportedLabel) {
    notes.push(`ANSWER_FROM_TARGET:${tag}`);
  }
  entries[answer]!.correct = true;

  if (entries.length > 4) {
    const keep = new Set([answer]);
    for (let index = 0; index < entries.length && keep.size < 4; index += 1) keep.add(index);
    entries = entries.filter((_, index) => keep.has(index));
    notes.push(`OPTIONS_TRIMMED:${tag}`);
  }
  const taken = new Set(entries.map((entry) => bareWord(entry.label)));
  const optionCount = entries.length;
  for (const candidate of [...siblings, ...NEUTRAL_DISTRACTORS]) {
    if (entries.length >= 4) break;
    if (taken.has(bareWord(candidate))) continue;
    taken.add(bareWord(candidate));
    entries.push({ label: candidate, zh: undefined, en: undefined, correct: false });
  }
  if (raw !== undefined && entries.length > optionCount) notes.push(`OPTIONS_PADDED:${tag}`);
  if (raw === undefined || raw.optionsEn.every((label) => label === '')) {
    // A question built here: vary where the answer sits instead of always putting it first.
    const from = entries.findIndex((entry) => entry.correct);
    const to = position % 4;
    const [moved] = entries.splice(from, 1);
    entries.splice(to, 0, moved!);
  }
  if (raw === undefined) notes.push(`QUESTION_BUILT:${tag}`);

  const correct = entries.findIndex((entry) => entry.correct);
  const fallbackZh = (entry: OptionEntry) => entry.correct
    ? `正确答案：${entry.label}${target.meaningZh ? `（${target.meaningZh}）` : ''}`
    : '这个词放进句子后意思不通。';
  const fallbackEn = (entry: OptionEntry) => entry.correct
    ? 'This is the target word, and it fits the sentence.'
    : 'This word does not fit the sentence.';
  return {
    targetId: target.id,
    targetAlias: target.alias,
    prompt: questionPrompt(raw?.prompt ?? '', entries[correct]!.label, located, notes, tag),
    optionsEn: entries.map((entry) => entry.label),
    correctOptionIndex: correct,
    meaningEn: raw?.meaningEn || `The word "${target.term ?? surface}" as used in the article.`,
    explanationZh: raw?.explanationZh || `“${surface}”在文中的意思是：${target.meaningZh}。`,
    optionExplanationsZh: entries.map((entry) => entry.zh || fallbackZh(entry)),
    optionExplanationsEn: entries.map((entry) => entry.en || fallbackEn(entry)),
  };
}

/** The model's prompt with its blank, or one made from the article sentence of the target. */
function questionPrompt(raw: string, answer: string, located: Located, notes: string[], alias: string): string {
  if (raw !== '') {
    if (raw.includes('____')) return raw;
    // No blank: if the sentence spells out the answer, that spot is where the blank belongs.
    const spelled = surfaceOccurrences({ key: '', text: raw, index: 0 }, answer, true)[0];
    if (!spelled) return raw;
    notes.push(`BLANK_ADDED:${alias}`);
    return `${raw.slice(0, spelled.start)}____${raw.slice(spelled.end)}`;
  }
  const { paragraph, start, end } = located;
  const sentence = sentenceContaining(paragraph.text, start);
  const sentenceStart = sentence === null ? -1 : paragraph.text.indexOf(sentence);
  if (sentence !== null && sentenceStart !== -1 && end <= sentenceStart + sentence.length) {
    return `${sentence.slice(0, start - sentenceStart)}____${sentence.slice(end - sentenceStart)}`;
  }
  return `${paragraph.text.slice(Math.max(0, start - 60), start)}____${paragraph.text.slice(end, end + 60)}`.trim();
}
