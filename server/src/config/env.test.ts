import { describe, expect, it } from 'vitest';

import { loadConfig } from './env';

describe('loadConfig', () => {
  it('口语点评复用现有密钥，仅支持低成本音频模型及限定超时，不打印错误配置值', () => {
    const base = { DATABASE_URL: 'postgresql://example.invalid/db', EVOLINK_API_KEY: 'secret', PUBLIC_SERVER_ORIGIN: 'http://localhost:3000' };
    expect(loadConfig(base).EVOLINK_AUDIO_MODEL).toBe('gemini-2.5-flash');
    expect(loadConfig(base).EVOLINK_AUDIO_TIMEOUT_MS).toBe(20000);
    expect(loadConfig(base).SPEAKING_COACH_DAILY_LIMIT).toBe(50);
    expect(() => loadConfig({ ...base, EVOLINK_AUDIO_MODEL: 'private-secret-url' })).toThrow('Invalid environment variables: EVOLINK_AUDIO_MODEL');
    expect(() => loadConfig({ ...base, EVOLINK_AUDIO_TIMEOUT_MS: '30000' })).toThrow('EVOLINK_AUDIO_TIMEOUT_MS');
  });
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
    expect(config.EVOLINK_TEXT_MODEL).toBe('gpt-6-luna');
    expect(config.EVOLINK_VISION_MODEL).toBe(
      'deepseek-v4-flash-vision-exp',
    );
    expect(config.EVOLINK_VISION_TIMEOUT_MS).toBe(120_000);
    expect(config.WECHAT_APP_ID).toBe('');
    expect(config.WECHAT_APP_SECRET).toBe('');
    expect(config.WECHAT_API_BASE_URL).toBe('https://api.weixin.qq.com');
    expect(config.WECHAT_TIMEOUT_MS).toBe(10_000);
    expect(config.RESEND_API_KEY).toBe('');
    expect(config.PASSWORD_RESET_FROM_EMAIL).toBe('');
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

  it('uses the Render public URL when no explicit public origin is set', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://example.invalid/db',
      EVOLINK_API_KEY: 'secret',
      RENDER_EXTERNAL_URL: 'https://waikan-api.onrender.com',
    });

    expect(config.publicServerOrigin).toBe(
      'https://waikan-api.onrender.com',
    );
  });

  it('prefers an explicit public origin over the Render public URL', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://example.invalid/db',
      EVOLINK_API_KEY: 'secret',
      PUBLIC_SERVER_ORIGIN: 'https://api.example.com',
      RENDER_EXTERNAL_URL: 'https://waikan-api.onrender.com',
    });

    expect(config.publicServerOrigin).toBe('https://api.example.com');
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

  it('requires a sender and API key together without printing their values', () => {
    const base = {
      DATABASE_URL: 'postgresql://example.invalid/db',
      EVOLINK_API_KEY: 'secret',
      PUBLIC_SERVER_ORIGIN: 'https://api.example.com',
    };
    expect(() => loadConfig({ ...base, RESEND_API_KEY: 'private-key' }))
      .toThrow('PASSWORD_RESET_FROM_EMAIL');
    expect(() => loadConfig({ ...base, PASSWORD_RESET_FROM_EMAIL: 'security@example.com' }))
      .toThrow('RESEND_API_KEY');
  });

  it('accepts an explicitly blank optional editorial audio origin', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://example.invalid/db',
      EVOLINK_API_KEY: 'secret',
      PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
      EDITORIAL_AUDIO_PUBLIC_ORIGIN: '',
    });

    expect(config.editorialAudioPublicOrigin).toBeUndefined();
  });
});
