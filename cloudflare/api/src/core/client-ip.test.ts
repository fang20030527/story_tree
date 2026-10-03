import { describe, expect, it } from 'vitest';
import type { ApiEnv } from '../env';
import { getClientIp, normalizeIpAddress } from './client-ip';
import { enforceRequestLimits } from './rate-limit';

const RELAY_IP = '43.161.240.244';
const SECRET = 'relay-test-secret-0123456789abcdef0123456789abcdef';
const CLIENT_IP = '203.0.113.7';

const relayEnv = {
  RELAY_SHARED_SECRET: SECRET,
  RELAY_IPS: ` ${RELAY_IP} , 2001:db8::1 `,
} as ApiEnv;

function request(headers: Record<string, string>): Request {
  return new Request('https://blackholeenglish.com/v1/dashboard', { headers });
}

function relayed(overrides: Record<string, string> = {}): Request {
  return request({
    'cf-connecting-ip': RELAY_IP,
    'x-relay-secret': SECRET,
    'x-relay-client-ip': CLIENT_IP,
    ...overrides,
  });
}

describe('getClientIp', () => {
  it('uses the relay client IP for an allowlisted relay with the shared secret', async () => {
    await expect(getClientIp(relayed(), relayEnv)).resolves.toBe(CLIENT_IP);
  });

  it('accepts and canonicalizes an IPv6 client and an IPv6 relay source', async () => {
    await expect(getClientIp(relayed({
      'cf-connecting-ip': '2001:DB8:0:0:0:0:0:1',
      'x-relay-client-ip': '2001:0DB8:0000::00AB',
    }), relayEnv)).resolves.toBe('2001:db8::ab');
  });

  it('ignores spoofed relay headers when no secret is configured', async () => {
    const env = { RELAY_IPS: RELAY_IP } as ApiEnv;
    await expect(getClientIp(relayed(), env)).resolves.toBe(RELAY_IP);
    await expect(getClientIp(relayed({ 'cf-connecting-ip': '198.51.100.20' }), env))
      .resolves.toBe('198.51.100.20');
    await expect(getClientIp(relayed(), { RELAY_SHARED_SECRET: '  ', RELAY_IPS: RELAY_IP } as ApiEnv))
      .resolves.toBe(RELAY_IP);
  });

  it('ignores a client IP header sent without the secret', async () => {
    await expect(getClientIp(request({
      'cf-connecting-ip': RELAY_IP,
      'x-relay-client-ip': CLIENT_IP,
    }), relayEnv)).resolves.toBe(RELAY_IP);
  });

  it('ignores a wrong secret, including truncated and extended values', async () => {
    for (const wrong of ['wrong', SECRET.slice(0, -1), `${SECRET}x`, `${SECRET.toUpperCase()}`, '']) {
      await expect(getClientIp(relayed({ 'x-relay-secret': wrong }), relayEnv)).resolves.toBe(RELAY_IP);
    }
  });

  it('ignores a correct secret from a source outside the allowlist', async () => {
    await expect(getClientIp(relayed({ 'cf-connecting-ip': '198.51.100.20' }), relayEnv))
      .resolves.toBe('198.51.100.20');
    await expect(getClientIp(relayed(), { RELAY_SHARED_SECRET: SECRET } as ApiEnv))
      .resolves.toBe(RELAY_IP);
  });

  it('falls back to the relay address when the forwarded client IP is invalid', async () => {
    for (const invalid of [
      '', 'unknown', '203.0.113.7, 198.51.100.1', '203.0.113.7:443', '[2001:db8::1]',
      '256.1.1.1', '1.2.3', '01.2.3.4', '0x7f.0.0.1', 'fe80::1%eth0', '2001:db8:::1', 'example.com',
    ]) {
      await expect(getClientIp(relayed({ 'x-relay-client-ip': invalid }), relayEnv)).resolves.toBe(RELAY_IP);
    }
  });

  it('keeps the existing unknown fallback without CF-Connecting-IP', async () => {
    await expect(getClientIp(request({}), {} as ApiEnv)).resolves.toBe('unknown');
    await expect(getClientIp(request({
      'x-relay-secret': SECRET,
      'x-relay-client-ip': CLIENT_IP,
    }), relayEnv)).resolves.toBe('unknown');
  });
});

describe('normalizeIpAddress', () => {
  it('accepts single literal IPv4 and IPv6 addresses only', () => {
    expect(normalizeIpAddress('192.0.2.1')).toBe('192.0.2.1');
    expect(normalizeIpAddress(' 192.0.2.1 ')).toBe('192.0.2.1');
    expect(normalizeIpAddress('::1')).toBe('::1');
    expect(normalizeIpAddress('::ffff:192.0.2.1')).toBe('::ffff:c000:201');
    expect(normalizeIpAddress('1.1.1.1.1')).toBeNull();
    expect(normalizeIpAddress(null)).toBeNull();
  });
});

describe('enforceRequestLimits', () => {
  it('rate-limits relayed users by their own client IP', async () => {
    const boundKeys: string[] = [];
    const db = {
      prepare: () => ({
        bind(...values: unknown[]) {
          boundKeys.push(String(values[0]));
          return this;
        },
        first: async () => ({ request_count: 1, expires_at: new Date(Date.now() + 60_000).toISOString() }),
      }),
    };
    const env = { ...relayEnv, DB: db } as unknown as ApiEnv;
    const digest = async (value: string) => Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');

    await enforceRequestLimits(relayed(), env);
    await enforceRequestLimits(relayed({ 'x-relay-client-ip': '198.51.100.99' }), env);
    await enforceRequestLimits(relayed({ 'x-relay-secret': 'spoofed' }), env);

    expect(boundKeys).toEqual([
      await digest(`global-ip:${CLIENT_IP}`),
      await digest('global-ip:198.51.100.99'),
      await digest(`global-ip:${RELAY_IP}`),
    ]);
  });
});
