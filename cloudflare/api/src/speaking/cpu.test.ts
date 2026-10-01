import { describe, expect, it, vi } from 'vitest';
import type { ApiEnv } from '../env';
import { handleSpeakingOnCpuBoundary } from './cpu';

describe('speaking CPU boundary forwarding', () => {
  it('forwards the authenticated identity and never trusts a caller supplied identity header', async () => {
    const fetch = vi.fn(async () => new Response('ok'));
    const getByName = vi.fn(() => ({ fetch }));
    const env = { CPU_BOUNDARY: { getByName } } as unknown as ApiEnv;
    const request = new Request('https://blackholeenglish.com/v1/speaking/materials/a/state', {
      method: 'PATCH', headers: { authorization: 'Bearer test-only', 'x-speaking-user-id': 'forged-user', 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 0, position: 1 }),
    });
    await handleSpeakingOnCpuBoundary(request, env, 'validated-user');
    const forwarded = (fetch.mock.calls[0] as unknown as [Request])[0];
    expect(forwarded.headers.get('x-speaking-user-id')).toBe('validated-user');
    expect(forwarded.headers.has('authorization')).toBe(false);
    expect(await forwarded.json()).toEqual({ revision: 0, position: 1 });
    expect(getByName).toHaveBeenCalledWith('speaking-validated-user');
  });
  it('removes caller identity from a public request and fails closed without the CPU binding', async () => {
    const fetch = vi.fn(async () => new Response('ok'));
    const env = { CPU_BOUNDARY: { getByName: () => ({ fetch }) } } as unknown as ApiEnv;
    await handleSpeakingOnCpuBoundary(new Request('https://blackholeenglish.com/v1/speaking/catalog', { headers: { 'x-speaking-user-id': 'forged-user' } }), env, null);
    expect((fetch.mock.calls[0] as unknown as [Request])[0].headers.has('x-speaking-user-id')).toBe(false);
    await expect(handleSpeakingOnCpuBoundary(new Request('https://blackholeenglish.com/v1/speaking/catalog'), {} as ApiEnv, null))
      .rejects.toMatchObject({ code: 'MEDIA_UNAVAILABLE', statusCode: 503 });
  });
});
