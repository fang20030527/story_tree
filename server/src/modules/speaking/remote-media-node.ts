import { Readable } from 'node:stream';
import { requestPinnedPage } from '../imports/extractors/safe-fetch';
import { resolveSafeHttpTarget } from '../imports/extractors/url-policy';
import type { OpenSpeakingRemoteUrl } from './remote-media';

export const openSpeakingRemoteUrlOnNode: OpenSpeakingRemoteUrl = async (url, signal) => {
  const target = await resolveSafeHttpTarget(url);
  const source = await requestPinnedPage(target, signal, 'audio/*,video/*,text/html,application/octet-stream');
  const headers = new Headers();
  for (const [key, value] of Object.entries(source.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const stream = Readable.toWeb(Readable.from(source.body)) as ReadableStream<Uint8Array>;
  return { url: target.url, response: new Response(source.statusCode === 204 ? null : stream, { status: source.statusCode, headers }),
    close: source.close };
};
