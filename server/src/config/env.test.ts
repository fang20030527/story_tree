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
      PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:8081,http://localhost:19006',
    });

    expect(config.publicServerOrigin).toBe('http://localhost:3000');
    expect(config.EVOLINK_VISION_MODEL).toBe(
      'deepseek-v4-flash-vision-exp',
    );
    expect(config.EVOLINK_VISION_TIMEOUT_MS).toBe(120_000);
    expect(config.IMPORT_MAX_TEXT_BYTES).toBe(131_072);
    expect(config.IMPORT_MAX_FILE_BYTES).toBe(10_485_760);
    expect(config.IMPORT_MAX_TOTAL_BYTES).toBe(31_457_280);
    expect(config.COMPUTER_UPLOAD_TTL_MS).toBe(600_000);
    expect(config.freePracticeLimit).toBe(3);
    expect(config.generationDeadlineMs).toBe(120_000);
    expect(config.corsOrigins).toEqual([
      'http://localhost:8081',
      'http://localhost:19006',
    ]);
  });

  it('requires a pathless HTTP(S) public server origin', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://example.invalid/db',
        EVOLINK_API_KEY: 'secret',
      }),
    ).toThrow(/PUBLIC_SERVER_ORIGIN/u);
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://example.invalid/db',
        EVOLINK_API_KEY: 'secret',
        PUBLIC_SERVER_ORIGIN: 'https://example.com/upload',
      }),
    ).toThrow(/PUBLIC_SERVER_ORIGIN/u);
  });
});
