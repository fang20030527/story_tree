import { describe, expect, it } from 'vitest';

import { hashEmailPassword, verifyEmailPassword } from './email-password';

describe('email password hashing', () => {
  it('hashes and verifies passwords without storing the plaintext', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = await hashEmailPassword(password);

    expect(hash).toMatch(/^scrypt-v1\$[^$]+\$[^$]+$/u);
    expect(hash).not.toContain(password);
    await expect(verifyEmailPassword(password, hash)).resolves.toBe(true);
    await expect(verifyEmailPassword('wrong-password', hash)).resolves.toBe(
      false,
    );
  });

  it('rejects malformed or unsupported hashes', async () => {
    await expect(verifyEmailPassword('password', '')).resolves.toBe(false);
    await expect(
      verifyEmailPassword('password', 'bcrypt$not-a-real-hash'),
    ).resolves.toBe(false);
  });
});
