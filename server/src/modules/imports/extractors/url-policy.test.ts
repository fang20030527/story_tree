import { describe, expect, it, vi } from 'vitest';

import { resolveSafeHttpTarget, type ResolveHost } from './url-policy';

describe('URL import network policy', () => {
  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.0.1/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://224.0.0.1/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'ftp://example.com/file',
    'https://user:password@example.com/',
  ])('blocks unsafe target %s', async (value) => {
    const resolver: ResolveHost = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);
    await expect(resolveSafeHttpTarget(value, resolver)).rejects.toMatchObject({
      code: 'IMPORT_FETCH_BLOCKED',
    });
  });

  it('fails closed when any DNS answer is not public unicast', async () => {
    const resolver: ResolveHost = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(
      resolveSafeHttpTarget('https://example.com/', resolver),
    ).rejects.toMatchObject({ code: 'IMPORT_FETCH_BLOCKED' });
  });

  it('returns the exact pinned public address and family', async () => {
    const resolver: ResolveHost = vi.fn().mockResolvedValue([
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    await expect(
      resolveSafeHttpTarget('https://example.com/story#fragment', resolver),
    ).resolves.toMatchObject({
      address: '2606:2800:220:1:248:1893:25c8:1946',
      family: 6,
      url: expect.objectContaining({ hash: '' }),
    });
  });
});
