import { describe, expect, it, vi } from 'vitest';

import type { ApiEnv } from '../env';
import { handlePublicEditorialRoute } from './public';

describe('public editorial routes', () => {
  it('returns the current empty published catalog without authentication', async () => {
    const response = await handlePublicEditorialRoute(
      new Request('https://api.example.test/v1/editorial/articles'),
      {} as ApiEnv,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ articles: [] });
  });

  it('serves legacy EPUB images through the image Worker', async () => {
    const fetch = vi.fn(async (_request: Request) =>
      new Response('image', { headers: { 'content-type': 'image/webp' } }));
    const env = { IMAGE_SERVICE: { fetch } } as unknown as ApiEnv;
    const id = '0123456789abcdef01234567.webp';
    const response = await handlePublicEditorialRoute(
      new Request(`https://api.example.test/v1/editorial/images/${id}`),
      env,
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(new URL((fetch.mock.calls[0] as unknown as [Request])[0].url).pathname)
      .toBe(`/${id}`);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('image/webp');
    expect(await response?.text()).toBe('image');
  });

  it('rejects malformed public asset names', async () => {
    await expect(handlePublicEditorialRoute(
      new Request('https://api.example.test/v1/editorial/assets/invalid.txt'),
      {} as ApiEnv,
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
