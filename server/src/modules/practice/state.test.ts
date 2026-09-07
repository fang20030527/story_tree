import type { PracticeStatus } from '@context-reader/contracts';
import { describe, expect, it } from 'vitest';

import { assertPracticeTransition } from './state';

describe('practice state transitions', () => {
  it('allows only the declared forward and bounded regeneration edges', () => {
    const allowed: Array<[PracticeStatus, PracticeStatus]> = [
      ['queued', 'generating'],
      ['queued', 'failed'],
      ['generating', 'validating'],
      ['generating', 'failed'],
      ['validating', 'generating'],
      ['validating', 'ready'],
      ['validating', 'failed'],
      ['ready', 'in_progress'],
      ['ready', 'completed'],
      ['in_progress', 'completed'],
    ];

    for (const transition of allowed) {
      expect(() => assertPracticeTransition(...transition)).not.toThrow();
    }

    const allStates: PracticeStatus[] = [
      'queued',
      'generating',
      'validating',
      'ready',
      'in_progress',
      'completed',
      'failed',
    ];
    const allowedKeys = new Set(allowed.map(([from, to]) => `${from}:${to}`));
    for (const from of allStates) {
      for (const to of allStates) {
        if (allowedKeys.has(`${from}:${to}`)) continue;
        expect(() => assertPracticeTransition(from, to)).toThrowError(
          expect.objectContaining({ code: 'STATE_CONFLICT', statusCode: 409 }),
        );
      }
    }
  });
});
