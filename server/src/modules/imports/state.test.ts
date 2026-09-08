import { describe, expect, it } from 'vitest';

import type { ArticleImportStatus } from '@context-reader/contracts';

import { canTransitionImport, type ImportTransitionCause } from './state';

const statuses: ArticleImportStatus[] = [
  'awaiting_upload',
  'queued',
  'processing',
  'retryable',
  'preview_ready',
  'confirmed',
  'failed',
  'expired',
  'cancelled',
];

const causes: ImportTransitionCause[] = [
  'upload_complete',
  'worker_claimed',
  'automatic_retry',
  'extraction_retryable',
  'preview_created',
  'confirmed',
  'permanent_failure',
  'cancelled',
  'expired',
  'user_retry',
];

const allowed = new Set([
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

describe('article import state machine', () => {
  it('permits exactly the approved edges and causes', () => {
    for (const from of statuses) {
      for (const to of statuses) {
        for (const cause of causes) {
          expect(canTransitionImport(from, to, cause)).toBe(
            allowed.has(`${from}:${to}:${cause}`),
          );
        }
      }
    }
  });
});
