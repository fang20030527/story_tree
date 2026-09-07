import {
  GeneratedPracticeSchema,
  type GeneratedPractice,
  type Verification,
} from './generated-schemas';
import type {
  AiProvider,
  GeneratePracticeInput,
  ModerationResult,
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
    const fillerWordCount = Math.max(0, 760 - targetWordCount);
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
      title: 'A Measured Study of Everyday Learning',
      paragraphs,
      usages: input.targets.map((target, index) => ({
        targetAlias: target.alias,
        paragraphKey: `p${(index % 3) + 1}`,
        surfaceForm: surfaces[index],
      })),
      questions: input.targets.map((target, index) => {
        const optionsZh = createOptions(target.meaningZh, index);
        return {
          targetAlias: target.alias,
          prompt: `${target.term} 在本文语境中的含义是什么？`,
          optionsZh,
          meaningEn: `${target.term} in its intended context`,
          explanationZh: `本文语境对应“${target.meaningZh}”。`,
          optionExplanationsZh: optionsZh.map((option) =>
            option === target.meaningZh ? '符合本文语境。' : '不符合本文语境。',
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

  async moderate(_text: string, signal: AbortSignal): Promise<ModerationResult> {
    signal.throwIfAborted();
    return { riskLevel: 'low', flagged: false };
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

function createOptions(meaningZh: string, index: number): string[] {
  const distractors = ['无关义项甲', '无关义项乙', '无关义项丙', '无关义项丁'];
  const options = [meaningZh];
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
