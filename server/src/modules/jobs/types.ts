import type { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';

export const jobKinds = [
  'practice_generation',
  'translation',
  'article_import',
  'article_translation',
] as const;

export type JobKind = (typeof jobKinds)[number];

export interface ClaimedJob {
  id: string;
  kind: JobKind;
  resourceId: string;
  attemptCount: number;
  maxAttempts: number;
  deadlineAt: Date;
  lockedBy: string;
  expired: boolean;
}

export type JobHandler = (
  job: ClaimedJob,
  context: { signal: AbortSignal },
) => Promise<void>;

export type JobFailureHandler = (
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
) => Promise<void>;

export interface JobRegistration {
  handle: JobHandler;
  onPermanentFailure: JobFailureHandler;
}

export interface RunnerOptions {
  db: AppDatabase;
  workerId: string;
  leaseMs: number;
  pollIntervalMs: number;
  enabledKinds: readonly JobKind[];
  registrations: Partial<Record<JobKind, JobRegistration>>;
}
