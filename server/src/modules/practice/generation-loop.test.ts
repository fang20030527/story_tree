import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../core/errors';
import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';
import type { GeneratePracticeInput } from '../../infrastructure/ai/types';
import {
  runPracticeGeneration,
  type GenerationLogEvent,
  type GenerationLoopOptions,
} from './generation-loop';
import { fixtureArticle, fixtureSpecs, fixtureTargets } from './generation-test-fixtures';
import {
  PracticeValidationError,
  validateGeneratedPractice,
  type ValidationOptions,
} from './generation-validator';

const input: GeneratePracticeInput = {
  examPath: 'ielts',
  topic: '环境',
  targets: fixtureSpecs.map(({ alias, term, meaningZh }) => ({ alias, term, meaningZh })),
};
const unavailable = () => new AppError('AI_UNAVAILABLE', 'rate limited', 503, true);
const unreadable = () => new AppError('AI_INVALID_OUTPUT', 'bad json', 502, true);

interface Flaws {
  /** Leaves two targets out of the article, which makes the draft unusable. */
  missing?: boolean;
  /** Everything the validator repairs or lets through. */
  messy?: boolean;
  /** An empty article. */
  empty?: boolean;
}

function draftWith(flaws: Flaws = {}, title = 'Learning to Live Together'): GeneratedPractice {
  const draft = fixtureArticle();
  draft.title = title;
  if (flaws.missing) {
    draft.paragraphs[2]!.text = draft.paragraphs[2]!.text.replace('resilient', 'strong');
    draft.paragraphs[1]!.text = draft.paragraphs[1]!.text.replace('initiative', 'plan');
  }
  if (flaws.messy) {
    draft.questions[0]!.prompt = 'Planting trees along the coast can ______ the damage caused by storms.';
    draft.questions[1]!.explanationZh = 'This word is correct for the sentence in every situation.';
    draft.questions[2]!.optionsEn = ['object', 'object', 'advocate'];
    draft.questions[2]!.correctOptionIndex = 7;
    draft.questions[3]!.prompt = 'Which word completes the sentence?';
    draft.questions[4]!.optionExplanationsZh = [];
    draft.questions.splice(5, 1);
    draft.paragraphs[1]!.text = 'Water is scarce, so every town needs an initiative to share it fairly with everyone.';
  }
  if (flaws.empty) draft.paragraphs = [{ key: 'p1', text: '' }];
  return draft;
}

const validate: GenerationLoopOptions['validate'] = async (generated, options: ValidationOptions) =>
  validateGeneratedPractice(generated, fixtureTargets, 'short', options);

function setup(provider: GenerationLoopOptions['provider'], extra: Partial<GenerationLoopOptions> = {}) {
  const calls: string[] = [];
  const events: GenerationLogEvent[] = [];
  const sleeps: number[] = [];
  const options: GenerationLoopOptions = {
    provider,
    input,
    validate,
    signal: new AbortController().signal,
    deadlineAt: new Date(Date.now() + 600_000),
    hooks: {
      onDraft: async () => { calls.push('draft'); },
      onValidated: async () => { calls.push('validated'); return true; },
    },
    sleep: async (ms) => { sleeps.push(ms); },
    log: (event) => events.push(event),
    ...extra,
  };
  return { options, calls, events, sleeps, run: () => runPracticeGeneration(options) };
}

function scripted(drafts: Array<GeneratedPractice | Error>) {
  const generatePractice = vi.fn<(request: GeneratePracticeInput) => Promise<GeneratedPractice>>(async () => {
    const next = drafts.length > 1 ? drafts.shift()! : drafts[0]!;
    if (next instanceof Error) throw next;
    return next;
  });
  return { generatePractice };
}

afterEach(() => vi.restoreAllMocks());

describe('one practice', () => {
  it('writes and checks a good draft once', async () => {
    const provider = scripted([draftWith()]);
    const { run, calls, events } = setup(provider);
    const validated = await run();
    expect(validated?.wordCount).toBe(218);
    expect(calls).toEqual(['draft', 'validated']);
    expect(provider.generatePractice).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.stage)).toEqual(['generate', 'validate', 'done']);
    // Diagnostics never carry article or vocabulary text.
    expect(JSON.stringify(events)).not.toMatch(/Climate|mitigate|scarce|resilient/u);
  });

  it('stores a messy draft as it is, repaired, with no rewrite and the repairs in the log', async () => {
    const provider = scripted([draftWith({ messy: true })]);
    const { run, calls, events } = setup(provider);
    const validated = await run();
    expect(provider.generatePractice).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['draft', 'validated']);
    expect(validated?.questions).toHaveLength(6);
    for (const question of validated!.questions) expect(question.optionsEn).toHaveLength(4);
    const logged = events.find((event) => event.stage === 'validate');
    expect(logged).toMatchObject({ outcome: 'ok' });
    // The prompt without a blank is rebuilt as a cloze from the article.
    expect(logged!.notes).toEqual(['WORD_COUNT_LOW:165', 'OPTIONS_PADDED:t3', 'PROMPT_REBUILT:t4', 'QUESTION_BUILT:t6']);
    for (const question of validated!.questions) expect(question.prompt).toContain('____');
  });

  it('rewrites an unusable draft once, sending back the previous draft and the missing targets', async () => {
    const first = draftWith({ missing: true });
    const provider = scripted([first, draftWith()]);
    const { run, calls } = setup(provider);
    await run();
    expect(provider.generatePractice).toHaveBeenCalledTimes(2);
    const revision = provider.generatePractice.mock.calls[1]![0].revision!;
    expect(revision.generated).toBe(first);
    expect(revision.issues).toEqual([expect.stringContaining('t5 ("initiative"), t6 ("resilient")')]);
    expect(calls).toEqual(['draft', 'draft', 'validated']);
  });

  it('completes the final draft instead of failing when a target is still missing', async () => {
    const provider = scripted([draftWith({ missing: true })]);
    const { run, events } = setup(provider);
    const validated = await run();
    expect(provider.generatePractice).toHaveBeenCalledTimes(4);
    expect(validated?.notes).toEqual(['TARGET_ADDED:t5', 'TARGET_ADDED:t6']);
    expect(validated?.usages.map((usage) => usage.surfaceForm)).toEqual(fixtureSpecs.map((spec) => spec.term));
    expect(events.filter((event) => event.stage === 'validate').map((event) => event.outcome))
      .toEqual(['unusable', 'unusable', 'unusable', 'ok']);
    expect(events.find((event) => event.outcome === 'unusable')).toMatchObject({ codes: ['TARGET_MISSING'] });
  });

  it('rewrites a reply without any question, then builds the questions on the final draft', async () => {
    const noQuestions = () => { const draft = draftWith(); draft.questions = []; return draft; };
    const once = scripted([noQuestions(), draftWith()]);
    await setup(once).run();
    expect(once.generatePractice).toHaveBeenCalledTimes(2);
    expect(once.generatePractice.mock.calls[1]![0].revision!.issues).toEqual([expect.stringContaining('no questions')]);

    const stubborn = scripted([noQuestions()]);
    const validated = await setup(stubborn).run();
    expect(stubborn.generatePractice).toHaveBeenCalledTimes(4);
    expect(validated?.questions).toHaveLength(6);
    expect(validated?.notes).toEqual(fixtureSpecs.map((spec) => `QUESTION_BUILT:${spec.alias}`));
  });

  it('fails only when every draft is unusable', async () => {
    const provider = scripted([draftWith({ empty: true })]);
    const { run, calls } = setup(provider);
    const error = await run().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PracticeValidationError);
    expect((error as PracticeValidationError).issueCodes).toEqual(['ARTICLE_EMPTY']);
    expect(provider.generatePractice).toHaveBeenCalledTimes(4);
    expect(calls).toEqual(['draft', 'draft', 'draft', 'draft']);
  });

  it('counts an unreadable reply as one draft instead of failing the attempt', async () => {
    const provider = scripted([unreadable(), draftWith()]);
    const { run } = setup(provider);
    await expect(run()).resolves.toMatchObject({ wordCount: 218 });
    expect(provider.generatePractice).toHaveBeenCalledTimes(2);
    const exhausted = scripted([unreadable()]);
    await expect(setup(exhausted).run()).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT', retryable: true });
    expect(exhausted.generatePractice).toHaveBeenCalledTimes(4);
  });

  it('keeps the previous draft in the next request when a later reply is unreadable', async () => {
    const first = draftWith({ missing: true });
    const provider = scripted([first, unreadable(), draftWith()]);
    await setup(provider).run();
    expect(provider.generatePractice.mock.calls[2]![0].revision!.generated).toBe(first);
  });

  it('stops quietly when another worker already finished the practice', async () => {
    const provider = scripted([draftWith()]);
    const { options } = setup(provider);
    options.hooks.onValidated = async () => false;
    await expect(runPracticeGeneration(options)).resolves.toBeNull();
  });
});

describe('transient provider failures', () => {
  it('are ridden out in place with growing pauses, without losing the draft', async () => {
    const provider = scripted([draftWith({ missing: true }), unavailable(), unavailable(), unavailable(), draftWith()]);
    const { run, sleeps } = setup(provider);
    await run();
    // The first draft was unusable; the rewrite hit three outages and still went through.
    expect(provider.generatePractice).toHaveBeenCalledTimes(5);
    const [, ...retries] = provider.generatePractice.mock.calls.map(([request]) => request);
    expect(retries.every((request) => request.revision !== undefined)).toBe(true);
    expect(retries[1]).toBe(retries[0]);
    expect(sleeps).toHaveLength(3);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1_500);
    expect(sleeps[0]).toBeLessThanOrEqual(2_500);
    expect(sleeps[2]).toBeGreaterThan(sleeps[0]!);
  });

  it('give up only after the configured number of repeats', async () => {
    const stubborn = scripted([unavailable()]);
    const { run, sleeps } = setup(stubborn);
    await expect(run()).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', retryable: true });
    expect(stubborn.generatePractice).toHaveBeenCalledTimes(4);
    expect(sleeps).toHaveLength(3);
  });

  it('are not retried when retrying is off or the error is permanent', async () => {
    const off = scripted([unavailable()]);
    await expect(setup(off, { retryDelaysMs: [] }).run()).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(off.generatePractice).toHaveBeenCalledTimes(1);
    const permanent = scripted([new AppError('AI_UNAVAILABLE', 'no key', 503, false)]);
    await expect(setup(permanent).run()).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', retryable: false });
    expect(permanent.generatePractice).toHaveBeenCalledTimes(1);
  });
});

describe('transient validation failures', () => {
  it('are repeated quickly, so a flaky Durable Object call does not cost a whole attempt', async () => {
    const provider = scripted([draftWith()]);
    const flaky = [new AppError('INTERNAL_ERROR', '服务暂时无法完成请求', 503, true)];
    const { run, sleeps, events } = setup(provider, {
      validate: async (generated, options) => {
        const failure = flaky.shift();
        if (failure) throw failure;
        return validate(generated, options);
      },
    });
    await expect(run()).resolves.toMatchObject({ wordCount: 218 });
    expect(provider.generatePractice).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeLessThanOrEqual(1_000);
    expect(events.filter((event) => event.stage === 'validate').map((event) => event.outcome)).toEqual(['INTERNAL_ERROR', 'ok', 'ok']);
  });

  it('give up after two repeats, and an unusable draft is never treated as an outage', async () => {
    const outage = new AppError('INTERNAL_ERROR', '服务暂时无法完成请求', 503, true);
    const validateCalls = vi.fn(async () => { throw outage; });
    await expect(setup(scripted([draftWith()]), { validate: validateCalls }).run()).rejects.toBe(outage);
    expect(validateCalls).toHaveBeenCalledTimes(3);

    const rejecting = scripted([draftWith({ empty: true })]);
    const { run, sleeps } = setup(rejecting);
    await expect(run()).rejects.toBeInstanceOf(PracticeValidationError);
    expect(sleeps).toHaveLength(0);

    const off = vi.fn(async () => { throw outage; });
    await expect(setup(scripted([draftWith()]), { validate: off, retryDelaysMs: [] }).run()).rejects.toBe(outage);
    expect(off).toHaveBeenCalledTimes(1);
  });
});

describe('time and cancellation', () => {
  it('refuses to start a provider call after the deadline', async () => {
    const provider = scripted([draftWith()]);
    const { run } = setup(provider, { deadlineAt: new Date(Date.now() - 1) });
    await expect(run()).rejects.toMatchObject({ code: 'GENERATION_DEADLINE_EXCEEDED', retryable: false });
    expect(provider.generatePractice).not.toHaveBeenCalled();
  });

  it('stops between a draft and its rewrite when the deadline passes', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const provider = scripted([draftWith({ missing: true })]);
    provider.generatePractice.mockImplementation(async () => { now = 2_000; return draftWith({ missing: true }); });
    const { run } = setup(provider, { deadlineAt: new Date(1_000) });
    await expect(run()).rejects.toMatchObject({ code: 'GENERATION_DEADLINE_EXCEEDED' });
    expect(provider.generatePractice).toHaveBeenCalledTimes(1);
  });

  it('stops at once when the job is cancelled, including while waiting to retry', async () => {
    const controller = new AbortController();
    const provider = scripted([unavailable()]);
    const { options } = setup(provider, { signal: controller.signal });
    options.sleep = async () => { controller.abort(new Error('lease lost')); controller.signal.throwIfAborted(); };
    await expect(runPracticeGeneration(options)).rejects.toThrow('lease lost');
    expect(provider.generatePractice).toHaveBeenCalledTimes(1);

    const cancelled = new AbortController();
    cancelled.abort(new Error('cancelled'));
    const idle = scripted([draftWith()]);
    await expect(setup(idle, { signal: cancelled.signal }).run()).rejects.toThrow('cancelled');
    expect(idle.generatePractice).not.toHaveBeenCalled();
  });
});

// A deterministic stand-in for an imperfect model: it sometimes leaves targets out of the
// article, usually writes questions with formatting slips, sometimes returns something that
// cannot be read, and the API behind it is rate limited now and then.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function noisyProvider(seed: number, title: string): GenerationLoopOptions['provider'] {
  const random = mulberry32(seed);
  let missing = random() < 0.2;
  return {
    async generatePractice(request) {
      if (random() < 0.08) throw unavailable();
      if (random() < 0.04) throw unreadable();
      // A rewrite fixes the omission when the problem list names it.
      const feedback = request.revision?.issues.join('\n') ?? '';
      if (missing && feedback.includes('do not appear in the article') && random() < 0.9) missing = false;
      return draftWith({ missing, messy: random() < 0.5 }, title);
    },
  };
}

/** What the job dispatcher does: a retryable failure starts a fresh attempt, up to three. */
async function asJob(seed: number, title: string) {
  for (let attempt = 1; ; attempt += 1) {
    let drafts = 0;
    const provider = noisyProvider(seed * 10 + attempt, title);
    try {
      const validated = await setup({ generatePractice: async (request, signal) => { drafts += 1; return provider.generatePractice(request, signal); } }).run();
      return { validated, attempt, drafts };
    } catch (error) {
      if (!(error instanceof AppError) || !error.retryable || attempt === 3) throw error;
    }
  }
}

describe('four essays at once', () => {
  it('all succeed, each with its own content, although the model is unreliable', async () => {
    const titles = ['Society', 'Environment', 'Technology', 'Politics'];
    const results = await Promise.all(titles.map((title, index) => asJob(index + 1, title)));
    expect(results.map((result) => result.validated?.title)).toEqual(titles);
    for (const { validated } of results) expect(validated?.usages).toHaveLength(6);
  });

  it('succeed for every one of 500 simulated essays, nearly always on the first draft and attempt', async () => {
    const outcomes = await Promise.all(Array.from({ length: 500 }, (_, index) => asJob(index + 100, `Essay ${index}`)));
    expect(outcomes.every((outcome) => outcome.validated !== null)).toBe(true);
    for (const { validated } of outcomes) {
      expect(validated!.usages).toHaveLength(6);
      for (const question of validated!.questions) expect(question.optionsEn).toHaveLength(4);
    }
    const averageDrafts = outcomes.reduce((sum, outcome) => sum + outcome.drafts, 0) / outcomes.length;
    expect(averageDrafts).toBeLessThan(1.6);
    expect(outcomes.filter((outcome) => outcome.attempt > 1).length / outcomes.length).toBeLessThan(0.02);
  });
});
