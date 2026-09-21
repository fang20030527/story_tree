import {
  GeneratedPracticeSchema,
  type GeneratedPractice,
  type Verification,
} from './generated-schemas';
import type { WordTranslationResult } from '@context-reader/contracts';
import type {
  AiProvider,
  GeneratePracticeInput,
  ModerationResult,
  OcrArticleText,
  OcrImage,
  VerifyPracticeInput,
} from './types';

const fillerCandidates = [
  'perspective',
  'thoughtful',
  'evidence',
  'inquiry',
  'reflection',
  'coherent',
  'measured',
  'scholarly',
  'balanced',
  'logical',
  'focused',
  'subtle',
  'precise',
  'meaningful',
  'careful',
  'purpose',
  'insight',
  'reader',
  'structure',
  'example',
];

export class FakeAiProvider implements AiProvider {
  async generatePractice(
    input: GeneratePracticeInput,
    signal: AbortSignal,
  ): Promise<GeneratedPractice> {
    signal.throwIfAborted();
    const surfaces = input.targets.map((target) => target.term.trim() || target.alias);
    const filler = selectFiller(surfaces);
    const targetWordCount = surfaces.reduce(
      (total, surface) => total + words(surface),
      0,
    );
    const fillerWordCount = Math.max(0, (input.topic ? 250 : 760) - targetWordCount);
    const targetsByParagraph = Array.from({ length: 3 }, () => [] as number[]);
    input.targets.forEach((_target, index) => {
      targetsByParagraph[index % 3]!.push(index);
    });

    const paragraphs = targetsByParagraph.map((targetIndexes, paragraphIndex) => {
      const count =
        Math.floor(fillerWordCount / 3) +
        (paragraphIndex < fillerWordCount % 3 ? 1 : 0);
      const fillerText = Array.from({ length: count }, () => filler).join(' ');
      const targetText = targetIndexes
        .map((targetIndex) => `${surfaces[targetIndex]}.`)
        .join(' ');
      return {
        key: `p${paragraphIndex + 1}`,
        text: `${fillerText}. ${targetText}`.trim(),
      };
    });

    return GeneratedPracticeSchema.parse({
      title: input.topic ? `${input.topic}: A Measured Study` : 'A Measured Study of Everyday Learning',
      paragraphs,
      usages: input.targets.map((target, index) => ({
        targetAlias: target.alias,
        paragraphKey: `p${(index % 3) + 1}`,
        surfaceForm: surfaces[index],
      })),
      questions: input.targets.map((target, index) => {
        const optionsEn = createOptions(target.term, index);
        return {
          targetAlias: target.alias,
          prompt: 'For this synthetic vocabulary exercise, choose ____ to complete the example.',
          optionsEn,
          correctOptionIndex: optionsEn.indexOf(target.term),
          meaningEn: `${target.term} in its intended context`,
          explanationEn: 'This is synthetic test feedback for the intended usage.',
          optionExplanationsEn: optionsEn.map((option) =>
            option === target.term ? 'Fits the intended context.' : 'Does not fit the intended context.',
          ),
        };
      }),
    });
  }

  async verifyPractice(
    _input: VerifyPracticeInput,
    signal: AbortSignal,
  ): Promise<Verification> {
    signal.throwIfAborted();
    return { approved: true, issues: [] };
  }

  async translate(text: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    return `译文：${text}`;
  }

  async lookupWord(
    term: string,
    _context: string | undefined,
    signal: AbortSignal,
  ): Promise<WordTranslationResult> {
    signal.throwIfAborted();
    const meanings: Record<string, WordTranslationResult> = {
      adaptation: { partOfSpeech: '名词；动词', meaningZh: '适应；改编' },
      careful: { partOfSpeech: '形容词', meaningZh: '仔细的；谨慎的' },
      context: { partOfSpeech: '名词', meaningZh: '语境；上下文' },
      evidence: { partOfSpeech: '名词', meaningZh: '证据；依据' },
      migration: { partOfSpeech: '名词', meaningZh: '迁徙；移居' },
      resilient: { partOfSpeech: '形容词', meaningZh: '有韧性的；能复原的' },
      routine: { partOfSpeech: '名词', meaningZh: '惯例；日常安排' },
      uncertain: { partOfSpeech: '形容词', meaningZh: '不确定的' },
    };
    return meanings[term.trim().toLocaleLowerCase('en-US')]
      ?? { partOfSpeech: '词性未知', meaningZh: `与“${term.trim()}”相关的词义` };
  }

  async moderate(_text: string, signal: AbortSignal): Promise<ModerationResult> {
    signal.throwIfAborted();
    return { riskLevel: 'low', flagged: false };
  }

  async extractArticleText(
    images: readonly OcrImage[],
    signal: AbortSignal,
  ): Promise<OcrArticleText> {
    signal.throwIfAborted();
    return {
      title: 'Synthetic imported article',
      text: images
        .map(
          ({ position }) =>
            `Image position ${position} contains original synthetic article words for careful readers who compare evidence, preserve context, inspect uncertainty, and revise measured conclusions when reliable facts change.`,
        )
        .join('\n\n'),
    };
  }
}

function selectFiller(surfaces: string[]): string {
  const normalized = surfaces.map((surface) => surface.toLocaleLowerCase('en-US'));
  return (
    fillerCandidates.find((candidate) =>
      normalized.every(
        (surface) =>
          !surface.includes(candidate) && !candidate.includes(surface),
      ),
    ) ?? 'vocabulary'
  );
}

function createOptions(term: string, index: number): string[] {
  const distractors = ['fragile', 'temporary', 'unclear', 'careless'];
  const options = [term];
  for (const distractor of distractors) {
    if (!options.includes(distractor)) options.push(distractor);
    if (options.length === 4) break;
  }
  const shift = index % options.length;
  return [...options.slice(shift), ...options.slice(0, shift)];
}

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
