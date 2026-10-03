import { describe, expect, it, vi } from 'vitest';
import { SPEAKING_MAX_REMOTE_MEDIA_BYTES } from '@context-reader/contracts';
import { fetchSpeakingRemoteMedia, type OpenSpeakingRemoteUrl } from './remote-media';

function wav() {
  const bytes = Buffer.alloc(32_044); bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(32_000, 40);
  return new Uint8Array(bytes);
}
function opener(responses: Response[]) {
  const close = vi.fn(async () => undefined);
  const open = vi.fn<OpenSpeakingRemoteUrl>(async url => {
    const response = responses.shift();
    if (!response) throw new Error('unexpected request');
    return { url: new URL(url), response, close };
  });
  return { open, close };
}
const signal = () => new AbortController().signal;

describe('口语网页媒体读取', () => {
  it('streams verified audio and returns only safe media headers', async () => {
    const { open, close } = opener([new Response(wav(), { headers: { 'content-type': 'audio/x-wav',
      'content-length': String(wav().length), 'set-cookie': 'private=value', 'content-disposition': 'attachment; filename="private.wav"' } })]);
    const response = await fetchSpeakingRemoteMedia('https://example.com/audio.wav', open, signal());
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('set-cookie')).toBe(false); expect(response.headers.has('content-disposition')).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(wav()); expect(close).toHaveBeenCalledTimes(1);
  });
  it('follows redirects and resolves relative HTML media without executing scripts', async () => {
    const { open, close } = opener([
      new Response(null, { status: 302, headers: { location: '/podcast/index.html' } }),
      new Response('<script>throw new Error("never execute")</script><audio><source src="../audio.wav"></audio>', { headers: { 'content-type': 'text/html' } }),
      new Response(wav(), { headers: { 'content-type': 'application/octet-stream' } }),
    ]);
    const response = await fetchSpeakingRemoteMedia('https://example.com/start', open, signal());
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(wav());
    expect(open.mock.calls.map(([url]) => url)).toEqual(['https://example.com/start', 'https://example.com/podcast/index.html', 'https://example.com/audio.wav']);
    expect(close).toHaveBeenCalledTimes(3);
  });
  it('rejects oversized, fake, mismatched, protected and playlist media', async () => {
    for (const response of [
      new Response(wav(), { headers: { 'content-type': 'audio/wav', 'content-length': String(SPEAKING_MAX_REMOTE_MEDIA_BYTES + 1) } }),
      new Response('pretending to be audio', { headers: { 'content-type': 'audio/wav' } }),
      new Response(wav(), { headers: { 'content-type': 'video/mp4' } }),
      new Response('<video src="https://example.com/live.m3u8"></video>', { headers: { 'content-type': 'text/html' } }),
      new Response('<p>Please log in</p>', { headers: { 'content-type': 'text/html' } }),
    ]) {
      const { open, close } = opener([response]);
      await expect(fetchSpeakingRemoteMedia('https://example.com/input', open, signal())).rejects.toBeInstanceOf(Error);
      expect(close).toHaveBeenCalled();
    }
  });
  it('detects truncated downloads and releases upstream on client cancellation', async () => {
    const truncated = opener([new Response(wav(), { headers: { 'content-type': 'audio/wav', 'content-length': String(wav().length + 1) } })]);
    const response = await fetchSpeakingRemoteMedia('https://example.com/audio', truncated.open, signal());
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: 'IMPORT_FETCH_FAILED' });
    expect(truncated.close).toHaveBeenCalledTimes(1);
    const cancelled = opener([new Response(wav(), { headers: { 'content-type': 'audio/wav' } })]);
    const download = await fetchSpeakingRemoteMedia('https://example.com/audio', cancelled.open, signal());
    await download.body!.cancel(); expect(cancelled.close).toHaveBeenCalledTimes(1);
  });
  it('stops redirect loops and aborts without leaking the upstream URL', async () => {
    const loop = opener(Array.from({ length: 6 }, () => new Response(null, { status: 302, headers: { location: '/loop' } })));
    await expect(fetchSpeakingRemoteMedia('https://example.com/private-source', loop.open, signal())).rejects.toMatchObject({ code: 'IMPORT_FETCH_FAILED' });
    expect(loop.close).toHaveBeenCalledTimes(6);
    const abort = new AbortController(); abort.abort();
    const never = opener([]);
    await expect(fetchSpeakingRemoteMedia('https://example.com/private-source', never.open, abort.signal)).rejects.toMatchObject({ code: 'IMPORT_FETCH_FAILED' });
    expect(never.open).not.toHaveBeenCalled();
  });
});
