import { describe, expect, it, vi } from 'vitest';
import { fetchSpeakingRemoteMedia } from '../../../../server/src/modules/speaking/remote-media';
import { handleSpeakingRemoteMediaRoute, speakingRemoteUrlOpener } from './remote-media';

describe('Workers 口语链接出站策略', () => {
  it('rejects private targets before any request, including redirects and page media', async () => {
    for (const target of ['http://127.0.0.1/file.mp3', 'http://[::1]/file', 'http://169.254.169.254/latest', 'https://localhost/file', 'https://api.internal/file', 'https://user:password@example.com/file']) {
      const requestPage = vi.fn<typeof fetch>();
      await expect(fetchSpeakingRemoteMedia(target, speakingRemoteUrlOpener(requestPage), new AbortController().signal)).rejects.toMatchObject({ code: 'IMPORT_FETCH_BLOCKED' });
      expect(requestPage).not.toHaveBeenCalled();
    }
    for (const response of [
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/file.mp3' } }),
      new Response('<audio src="http://169.254.169.254/file.mp3"></audio>', { headers: { 'content-type': 'text/html' } }),
    ]) {
      const requestPage = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
      await expect(fetchSpeakingRemoteMedia('https://example.com/page', speakingRemoteUrlOpener(requestPage), new AbortController().signal)).rejects.toMatchObject({ code: 'IMPORT_FETCH_BLOCKED' });
      expect(requestPage).toHaveBeenCalledTimes(1);
      expect(requestPage.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
      expect(requestPage.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
    }
  });
  it('validates bounded JSON and ignores unrelated routes', async () => {
    expect(await handleSpeakingRemoteMediaRoute(new Request('https://example.com/v1/speaking/materials'))).toBeNull();
    for (const body of [{ url: 'file:///private/movie.mp4' }, { url: 'https://example.com/video', token: 'unexpected' }, { url: 'x'.repeat(5000) }]) {
      await expect(handleSpeakingRemoteMediaRoute(new Request('https://example.com/v1/speaking/remote-media', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});
