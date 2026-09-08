import { describe, expect, it, vi } from 'vitest';

import { assertJobRegistrations } from './runner';
import { jobKinds, type JobKind, type JobRegistration } from './types';

describe('job handler registry', () => {
  it('requires a handler and permanent-failure hook for every enabled kind', () => {
    expect(() =>
      assertJobRegistrations(['practice_generation'], {}),
    ).toThrow(/practice_generation/u);

    expect(() =>
      assertJobRegistrations(['practice_generation'], {
        practice_generation: {
          handle: vi.fn(),
          onPermanentFailure: vi.fn(),
        },
      }),
    ).not.toThrow();
  });

  it('requires complete registrations for every persisted job kind', () => {
    const registration = (): JobRegistration => ({
      handle: vi.fn(),
      onPermanentFailure: vi.fn(),
    });
    const complete = {
      practice_generation: registration(),
      translation: registration(),
      article_import: registration(),
      article_translation: registration(),
    };

    expect(jobKinds).toEqual([
      'practice_generation',
      'translation',
      'article_import',
      'article_translation',
    ]);
    expect(() => assertJobRegistrations(jobKinds, complete)).not.toThrow();
    const omit = (kind: JobKind) => {
      const incomplete: Partial<Record<JobKind, JobRegistration>> = {
        ...complete,
      };
      delete incomplete[kind];
      return incomplete;
    };
    expect(() =>
      assertJobRegistrations(jobKinds, omit('article_import')),
    ).toThrow(/article_import/u);
    expect(() =>
      assertJobRegistrations(jobKinds, omit('article_translation')),
    ).toThrow(/article_translation/u);
  });
});
