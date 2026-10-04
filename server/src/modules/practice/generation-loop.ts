import { AppError } from '../../core/errors';
import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';
import type { AiProvider, GeneratePracticeInput } from '../../infrastructure/ai/types';
import {
  PracticeValidationError,
  type ValidatedGeneratedPractice,
  type ValidationOptions,
} from './generation-validator';

/** Drafts one job attempt may write before it gives the attempt back to the queue. */
export const MAX_GENERATION_DRAFTS = 4;
/**
 * Waits before re-sending a call that failed with a transient provider error. A short
 * outage (rate limit, gateway error, timeout) must not cost the practice.
 */
const PROVIDER_RETRY_DELAYS_MS = [2_000, 5_000, 12_000] as const;
/** Validation is deterministic and cheap to repeat, so a flaky Durable Object call is retried quickly. */
const VALIDATION_RETRY_DELAYS_MS = [500, 1_500] as const;

export type GenerationLogEvent = Record<string, string | number | boolean | readonly string[] | undefined>;

export interface GenerationLoopHooks {
  /** A draft arrived (progress 40). */
  onDraft(): Promise<void>;
  /** The draft is usable and is about to be stored (progress 60). False: finished elsewhere. */
  onValidated(): Promise<boolean>;
}

export interface GenerationLoopOptions {
  provider: Pick<AiProvider, 'generatePractice'>;
  input: GeneratePracticeInput;
  validate(generated: GeneratedPractice, options: ValidationOptions): Promise<ValidatedGeneratedPractice>;
  signal: AbortSignal;
  deadlineAt: Date;
  hooks: GenerationLoopHooks;
  maxDrafts?: number;
  /** Waits between provider retries; an empty list disables all retrying. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Diagnostics: stages, outcomes, counts and repair notes. Never article or vocabulary text. */
  log?: (event: GenerationLogEvent) => void;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function outcomeOf(error: unknown): string {
  if (error instanceof AppError) return error.code;
  return error instanceof Error ? error.name : 'error';
}

/**
 * Write one practice and make it storable. A draft is rewritten only when it is unusable:
 * the reply cannot be read, the article is empty or not English, or a target is missing from
 * it. Everything else is repaired by the validator or let through. A transient provider
 * failure retries the same call instead of discarding the draft. The final draft is completed
 * by the validator rather than rejected over a missing target. Returns null when another
 * worker finished the practice in the meantime.
 */
export async function runPracticeGeneration(
  options: GenerationLoopOptions,
): Promise<ValidatedGeneratedPractice | null> {
  const { provider, input, validate, signal, deadlineAt, hooks } = options;
  const maxDrafts = options.maxDrafts ?? MAX_GENERATION_DRAFTS;
  const delays = options.retryDelaysMs ?? PROVIDER_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? abortableSleep;
  const log = options.log ?? (() => undefined);

  const checkpoint = () => {
    signal.throwIfAborted();
    if (Date.now() >= deadlineAt.getTime()) {
      throw new AppError('GENERATION_DEADLINE_EXCEEDED', '练习生成已超过截止时间', 504);
    }
  };

  /** Run a call, re-sending it after a pause when it fails in a way that is worth repeating. */
  async function withRetries<T>(
    stage: string,
    draft: number,
    pauses: readonly number[],
    isTransient: (error: unknown) => boolean,
    call: () => Promise<T>,
  ): Promise<T> {
    for (let retry = 0; ; retry += 1) {
      checkpoint();
      const startedAt = Date.now();
      try {
        const result = await call();
        if (retry > 0 || stage !== 'validate') log({ stage, draft, outcome: 'ok', retries: retry, ms: Date.now() - startedAt });
        return result;
      } catch (error) {
        const transient = isTransient(error);
        if (transient || stage !== 'validate') {
          log({ stage, draft, outcome: outcomeOf(error), retries: retry, ms: Date.now() - startedAt });
        }
        if (!transient || retry >= pauses.length) throw error;
        await sleep(Math.round(pauses[retry]! * (0.75 + Math.random() * 0.5)), signal);
      }
    }
  }

  const isProviderOutage = (error: unknown) =>
    error instanceof AppError && error.code === 'AI_UNAVAILABLE' && error.retryable;
  // A rejected draft is a verdict, not a failure; anything else retryable (a flaky
  // Durable Object call, for instance) is repeated before the whole attempt is given up.
  const validationPauses = delays.length === 0 ? [] : VALIDATION_RETRY_DELAYS_MS;
  const isValidationOutage = (error: unknown) =>
    error instanceof AppError && error.retryable && !(error instanceof PracticeValidationError);

  let draft: GeneratedPractice | undefined;
  let issues: string[] = [];
  for (let index = 0; index < maxDrafts; index += 1) {
    const last = index === maxDrafts - 1;
    const request: GeneratePracticeInput = draft
      ? { ...input, revision: { generated: draft, issues } }
      : input;

    let generated: GeneratedPractice;
    try {
      generated = await withRetries('generate', index, delays, isProviderOutage, () => provider.generatePractice(request, signal));
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'AI_INVALID_OUTPUT' || last) throw error;
      issues = ['Your previous reply could not be read. Return exactly one JSON object that follows the template.'];
      continue;
    }
    await hooks.onDraft();

    const checkedAt = Date.now();
    let validated: ValidatedGeneratedPractice;
    try {
      validated = await withRetries('validate', index, validationPauses, isValidationOutage,
        () => validate(generated, { completeMissing: last }));
    } catch (error) {
      if (!(error instanceof PracticeValidationError)) throw error;
      log({
        stage: 'validate', draft: index, outcome: 'unusable', ms: Date.now() - checkedAt,
        codes: error.issueCodes, issues: error.repairIssues.length,
      });
      if (last) throw error;
      draft = generated;
      issues = error.repairIssues;
      continue;
    }
    log({
      stage: 'validate', draft: index, outcome: 'ok', ms: Date.now() - checkedAt,
      words: validated.wordCount, notes: (validated.notes ?? []).slice(0, 20),
    });

    if (!(await hooks.onValidated())) return null;
    log({ stage: 'done', draft: index, words: validated.wordCount });
    return validated;
  }
  throw new AppError('AI_INVALID_OUTPUT', '生成的内容无法使用', 502, true);
}
