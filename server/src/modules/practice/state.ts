import type { PracticeStatus } from '@context-reader/contracts';

import { AppError } from '../../core/errors';

const allowedTransitions: Record<PracticeStatus, readonly PracticeStatus[]> = {
  queued: ['generating', 'failed'],
  generating: ['validating', 'failed'],
  validating: ['generating', 'ready', 'failed'],
  ready: ['in_progress', 'completed'],
  in_progress: ['completed'],
  completed: [],
  failed: [],
};

export function assertPracticeTransition(
  from: PracticeStatus,
  to: PracticeStatus,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new AppError('STATE_CONFLICT', '练习状态已变更', 409);
  }
}
