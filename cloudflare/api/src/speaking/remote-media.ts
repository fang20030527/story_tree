import { SpeakingRemoteMediaRequestSchema } from '@context-reader/contracts';
import { AppError } from '../../../../server/src/core/errors';
import { fetchSpeakingRemoteMedia, type OpenSpeakingRemoteUrl } from '../../../../server/src/modules/speaking/remote-media';
import { readJsonBody } from '../core/http';
import { publicHtmlUrl } from '../imports/safe-fetch';

export function speakingRemoteUrlOpener(requestPage: typeof fetch = fetch): OpenSpeakingRemoteUrl {
  return async (raw, signal) => {
    const url = publicHtmlUrl(raw);
    const response = await requestPage(url, { redirect: 'manual', signal, headers: {
      accept: 'audio/*,video/*,text/html,application/octet-stream', 'accept-encoding': 'identity',
    } });
    return { url, response, close: async () => { await response.body?.cancel().catch(() => undefined); } };
  };
}

export async function handleSpeakingRemoteMediaRoute(request: Request): Promise<Response | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/speaking/remote-media') return null;
  const body = SpeakingRemoteMediaRequestSchema.safeParse(await readJsonBody(request, 4096));
  if (!body.success) throw new AppError('VALIDATION_ERROR', '请填写公开的音视频或网页链接', 400);
  return fetchSpeakingRemoteMedia(body.data.url, speakingRemoteUrlOpener(), request.signal);
}
