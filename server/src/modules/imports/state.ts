import type { ArticleImportStatus } from '@context-reader/contracts';

import { AppError } from '../../core/errors';

export type ImportTransitionCause =
  | 'upload_complete'
  | 'worker_claimed'
  | 'automatic_retry'
  | 'extraction_retryable'
  | 'preview_created'
  | 'confirmed'
  | 'permanent_failure'
  | 'cancelled'
  | 'expired'
  | 'user_retry';

const transitions = new Set<string>([
  'awaiting_upload:queued:upload_complete',
  'awaiting_upload:expired:expired',
  'awaiting_upload:cancelled:cancelled',
  'queued:processing:worker_claimed',
  'queued:failed:permanent_failure',
  'queued:cancelled:cancelled',
  'processing:preview_ready:preview_created',
  'processing:queued:automatic_retry',
  'processing:retryable:extraction_retryable',
  'processing:failed:permanent_failure',
  'processing:cancelled:cancelled',
  'retryable:queued:user_retry',
  'retryable:expired:expired',
  'retryable:cancelled:cancelled',
  'preview_ready:confirmed:confirmed',
  'preview_ready:expired:expired',
  'preview_ready:cancelled:cancelled',
]);

export function canTransitionImport(
  from: ArticleImportStatus,
  to: ArticleImportStatus,
  cause: ImportTransitionCause,
): boolean {
  return transitions.has(`${from}:${to}:${cause}`);
}

export function assertImportTransition(
  from: ArticleImportStatus,
  to: ArticleImportStatus,
  cause: ImportTransitionCause,
): void {
  if (!canTransitionImport(from, to, cause)) {
    throw new AppError('STATE_CONFLICT', '导入状态已变更', 409);
  }
}
