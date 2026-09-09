import { describe, expect, it } from 'vitest';

import {
  capabilityMatches,
  createCapabilityToken,
  deriveUploadCode,
  hashUploadCode,
  normalizeUploadCode,
} from './code';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const otherSessionId = '44444444-4444-4444-8444-444444444444';

describe('computer upload codes', () => {
  it('derives a deterministic 50-bit Crockford code from token, user, and session', () => {
    const first = deriveUploadCode('a'.repeat(64), userId, sessionId);
    const replay = deriveUploadCode('a'.repeat(64), userId, sessionId);
    expect(first).toBe(replay);
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/u);
    expect(first).toBe(deriveUploadCode('a'.repeat(64), userId, sessionId));
    expect(deriveUploadCode('b'.repeat(64), userId, sessionId)).not.toBe(first);
    expect(deriveUploadCode('a'.repeat(64), otherUserId, sessionId)).not.toBe(
      first,
    );
    expect(deriveUploadCode('a'.repeat(64), userId, otherSessionId)).not.toBe(
      first,
    );
  });

  it('separates the domain, user, and session fields with NUL delimiters', () => {
    const token = 'a'.repeat(64);
    // Same concatenation "a"+"bcd" === "ab"+"cd" === "abc"+"d"; only NUL
    // delimiters keep these identities distinct.
    const first = deriveUploadCode(token, 'a', 'bcd');
    const second = deriveUploadCode(token, 'ab', 'cd');
    const third = deriveUploadCode(token, 'abc', 'd');
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('normalizes spacing, case, and confusable characters', () => {
    const first = deriveUploadCode('a'.repeat(64), userId, sessionId);
    expect(
      normalizeUploadCode(
        `${first.slice(0, 5)}-${first.slice(5).toLowerCase()}`,
      ),
    ).toBe(first);
    expect(normalizeUploadCode('OIL01-ABCDE')).toBe('01101ABCDE');
    expect(hashUploadCode(first)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects malformed codes with a fixed expiry error', () => {
    for (const value of ['', 'SHORT', ' way too long code ', '###bad###ok']) {
      expect(() => normalizeUploadCode(value)).toThrowError(
        expect.objectContaining({ code: 'UPLOAD_SESSION_EXPIRED' }),
      );
    }
  });

  it('issues capability tokens that match only their own hash', () => {
    const capability = createCapabilityToken();
    expect(capability.raw).not.toBe(capability.hash);
    expect(capability.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(capabilityMatches(capability.raw, capability.hash)).toBe(true);
    expect(capabilityMatches(`${capability.raw}x`, capability.hash)).toBe(false);
    expect(capabilityMatches(capability.raw, 'ff'.repeat(32))).toBe(false);
  });
});
