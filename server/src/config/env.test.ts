import { describe, expect, it } from 'vitest';

import { loadConfig } from './env';

describe('loadConfig', () => {
  it('rejects missing secrets without printing values', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL, EVOLINK_API_KEY/);
  });

  it('parses defaults and comma-separated CORS origins', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://example.invalid/db',
      EVOLINK_API_KEY: 'secret',
      CORS_ORIGINS: 'http://localhost:8081,http://localhost:19006',
    });

    expect(config.freePracticeLimit).toBe(3);
    expect(config.generationDeadlineMs).toBe(120_000);
    expect(config.corsOrigins).toEqual([
      'http://localhost:8081',
      'http://localhost:19006',
    ]);
  });
});
