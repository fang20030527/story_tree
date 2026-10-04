import { describe, expect, it } from 'vitest';

import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';
import { fixtureArticle, fixtureTargets } from './generation-test-fixtures';
import { validateGeneratedPractice, type GenerationTarget } from './generation-validator';

type RawQuestion = GeneratedPractice['questions'][number];

/** The six fixture targets, with the given questions planned for some of them and one for the rest. */
function planned(counts: Record<string, number>): GenerationTarget[] {
  return fixtureTargets.map((target) => ({ ...target, questionCount: counts[target.alias] ?? 1 }));
}

/** The question the fixture article has for an alias, rewritten as a new question of the same target. */
function another(alias: string, prompt: string, change: (question: RawQuestion) => void = () => undefined): RawQuestion {
  const question = structuredClone(fixtureArticle().questions.find((item) => item.targetAlias === alias)!);
  question.prompt = prompt;
  change(question);
  return question;
}

function draftWith(...extra: RawQuestion[]): GeneratedPractice {
  const draft = fixtureArticle();
  draft.questions.push(...extra);
  return draft;
}

const labels = (questions: Array<{ targetAlias: string; round: number }>) =>
  questions.map((question) => `${question.targetAlias}:${question.round}`);

describe('a target with several planned questions', () => {
  it('keeps the questions the reply wrote and returns them round by round', () => {
    const draft = draftWith(
      another('t1', 'The ____ community recovered quickly after the storm.'),
      another('t2', 'Using ____ methods keeps the soil healthy for the next generation.'),
    );

    const result = validateGeneratedPractice(draft, planned({ t1: 2, t2: 2 }), 'short');

    expect(labels(result.questions)).toEqual([
      't1:0', 't2:0', 't3:0', 't4:0', 't5:0', 't6:0', 't1:1', 't2:1',
    ]);
    expect(result.questions[6]!.prompt).toBe('The ____ community recovered quickly after the storm.');
    expect(result.questions[7]!.prompt).toBe('Using ____ methods keeps the soil healthy for the next generation.');
    expect(result.notes).toBeUndefined();
    for (const question of result.questions) {
      expect(question.optionsEn).toHaveLength(4);
      expect(question.optionsEn[question.correctOptionIndex]).toBe(
        fixtureTargets.find((target) => target.alias === question.targetAlias)!.term,
      );
    }
  });

  it('orders by round even when the reply lists the questions of one target together', () => {
    const draft = fixtureArticle();
    const grouped: RawQuestion[] = [];
    for (const question of draft.questions) {
      grouped.push(question, another(question.targetAlias, `A second ____ sentence for ${question.targetAlias}.`));
    }
    draft.questions = grouped;
    const counts = Object.fromEntries(fixtureTargets.map((target) => [target.alias, 2]));

    const result = validateGeneratedPractice(draft, planned(counts), 'short');

    expect(labels(result.questions)).toEqual([
      ...fixtureTargets.map((target) => `${target.alias}:0`),
      ...fixtureTargets.map((target) => `${target.alias}:1`),
    ]);
    expect(result.questions.slice(6).map((question) => question.prompt)).toEqual(
      fixtureTargets.map((target) => `A second ____ sentence for ${target.alias}.`),
    );
  });

  it('ignores questions beyond the plan, and unplanned targets keep only their first question', () => {
    const draft = draftWith(
      another('t1', 'First extra ____ sentence.'),
      another('t1', 'Second extra ____ sentence.'),
      another('t3', 'An unplanned ____ sentence.'),
    );

    const result = validateGeneratedPractice(draft, planned({ t1: 2 }), 'short');

    expect(labels(result.questions)).toEqual([
      't1:0', 't2:0', 't3:0', 't4:0', 't5:0', 't6:0', 't1:1',
    ]);
    expect(result.questions.at(-1)!.prompt).toBe('First extra ____ sentence.');
    expect(result.notes).toBeUndefined();
  });

  it('drops an extra question that repeats the first or has no prompt, and notes the shortfall', () => {
    const draft = draftWith(
      // The same sentence with another length of blank and different case.
      another('t1', 'planting trees along the coast can ______ the damage CAUSED by storms.'),
      another('t2', ''),
      another('t3', 'A new ____ sentence about doctors and walking.'),
    );

    const result = validateGeneratedPractice(draft, planned({ t1: 2, t2: 2, t3: 2 }), 'short');

    expect(labels(result.questions)).toEqual([
      't1:0', 't2:0', 't3:0', 't4:0', 't5:0', 't6:0', 't3:1',
    ]);
    expect(result.notes).toEqual(['QUESTIONS_SHORT:t1:1/2', 'QUESTIONS_SHORT:t2:1/2']);
  });

  it('never builds an extra question: a reply with none gives one per target and a note', () => {
    const result = validateGeneratedPractice(fixtureArticle(), planned({ t4: 3 }), 'short');

    expect(labels(result.questions)).toEqual(fixtureTargets.map((target) => `${target.alias}:0`));
    expect(result.notes).toEqual(['QUESTIONS_SHORT:t4:1/3']);
  });

  it('still builds the first question from the article when only the extra ones are missing from the reply', () => {
    const draft = fixtureArticle();
    draft.questions = draft.questions.filter((question) => question.targetAlias !== 't1');
    draft.questions.push(another('t2', 'An additional ____ sentence about farms.'));

    const result = validateGeneratedPractice(draft, planned({ t1: 2, t2: 2 }), 'short', { completeMissing: true });

    expect(labels(result.questions)).toEqual([
      't1:0', 't2:0', 't3:0', 't4:0', 't5:0', 't6:0', 't2:1',
    ]);
    expect(result.questions[0]!.optionsEn[result.questions[0]!.correctOptionIndex]).toBe('mitigate');
    expect(result.notes).toEqual(['QUESTION_BUILT:t1', 'QUESTIONS_SHORT:t1:1/2']);
  });

  it('repairs an extra question like any other and names the round in the note', () => {
    const draft = draftWith(
      another('t3', 'A good doctor will ____ for a balanced diet.', (question) => { question.correctOptionIndex = 0; }),
    );

    const result = validateGeneratedPractice(draft, planned({ t3: 2 }), 'short');

    const extra = result.questions.find((question) => question.targetAlias === 't3' && question.round === 1)!;
    expect(extra.optionsEn[extra.correctOptionIndex]).toBe('advocate');
    expect(result.notes).toEqual(['ANSWER_FROM_TARGET:t3#2']);
  });

  it('rejects a reply with no question at all even when several are planned', () => {
    const draft = fixtureArticle();
    draft.questions = [];

    expect(() => validateGeneratedPractice(draft, planned({ t1: 3 }), 'short')).toThrowError(
      expect.objectContaining({ issueCodes: ['QUESTIONS_MISSING'] }),
    );
  });

  it('keeps asking one question per target when no plan is given', () => {
    const draft = draftWith(another('t1', 'A different ____ sentence.'));

    const result = validateGeneratedPractice(draft, fixtureTargets, 'short');

    expect(labels(result.questions)).toEqual(fixtureTargets.map((target) => `${target.alias}:0`));
    expect(result.notes).toBeUndefined();
  });
});
