import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPasswordResetMailer } from './password-reset-mailer';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('password reset mailer', () => {
  it('uses the Resend API with a server-only key and plain text code', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;
    const mailer = createPasswordResetMailer({
      RESEND_API_KEY: 'resend-test-key',
      PASSWORD_RESET_FROM_EMAIL: 'security@example.com',
    });
    await mailer!.sendCode('reader@example.com', 'ABCDEFGHJKLM');

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer resend-test-key' }),
        body: expect.stringContaining('ABCD EFGH JKLM'),
      }));
  });

  it('stays unavailable until both mail settings are supplied', () => {
    expect(createPasswordResetMailer({ RESEND_API_KEY: '', PASSWORD_RESET_FROM_EMAIL: '' })).toBeNull();
  });
});
