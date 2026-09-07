import { describe, expect, it, vi } from 'vitest';

import { assertJobRegistrations } from './runner';

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
});
