import { getSpeakingCatalogPlayback } from '@/api/speaking';

type SpeakingPlaybackDto = Awaited<ReturnType<typeof getSpeakingCatalogPlayback>>;

// Signing a released film's playback link is one more request before the video can start. The
// detail and shadowing screens start it as soon as they know the film, while captions load.
const FRESH_MS = 60_000;
const pending = new Map<string, { promise: Promise<SpeakingPlaybackDto>; startedAt: number }>();

export function prefetchCatalogPlayback(id: string): void {
  const current = pending.get(id);
  if (current && Date.now() - current.startedAt < FRESH_MS) return;
  const promise = getSpeakingCatalogPlayback(id);
  pending.set(id, { promise, startedAt: Date.now() });
  promise.catch(() => { if (pending.get(id)?.promise === promise) pending.delete(id); });
}

/** Test hook: forget links prefetched by an earlier screen. */
export function clearPlaybackPrefetch(): void {
  pending.clear();
}

/** Uses a recent prefetched link once; otherwise, and for every later refresh, signs a new one. */
export function catalogPlayback(id: string): Promise<SpeakingPlaybackDto> {
  const current = pending.get(id);
  pending.delete(id);
  if (current && Date.now() - current.startedAt < FRESH_MS) return current.promise;
  return getSpeakingCatalogPlayback(id);
}
