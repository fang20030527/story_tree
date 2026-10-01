/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import type VideoPlayerWeb from 'expo-video/build/VideoPlayer.web';
import { ShadowingVideo } from './ShadowingMedia';
import { useShadowingPlayback } from './useShadowingPlayback';

const mockPlayers: VideoPlayerWeb[] = [];
const mockPlayerHookRenders = jest.fn();
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]) }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('expo-audio', () => ({ useAudioPlayer: jest.fn(), useAudioPlayerStatus: jest.fn(), setAudioModeAsync: jest.fn() }));
jest.mock('expo-video', () => {
  const sdk = jest.requireActual<typeof import('expo-video/build/VideoPlayer.web')>('expo-video/build/VideoPlayer.web');
  const views = jest.requireActual<typeof import('expo-video/build/VideoView.web')>('expo-video/build/VideoView.web');
  function useActualVideoPlayer(...args: Parameters<typeof sdk.useVideoPlayer>) {
    const player = sdk.useVideoPlayer(...args);
    if (!mockPlayers.includes(player as VideoPlayerWeb)) mockPlayers.push(player as VideoPlayerWeb);
    mockPlayerHookRenders();
    return player;
  }
  return { ...sdk, VideoView: views.default, useVideoPlayer: useActualVideoPlayer };
});
const cues = [{ id: 'one', start: 201, end: 203, en: 'Hello there.', zh: '' }];
function Harness({ source, expanded = false }: { source: string; expanded?: boolean }) {
  const playback = useShadowingPlayback(cues);
  return <div><ShadowingVideo key={source} source={source} title="Movie" expanded={expanded}
    onController={playback.onController} onState={playback.onState} />
    <button onClick={() => void playback.seek(201, true)} disabled={!playback.loaded}>Play cue</button>
    <output data-testid="position">{playback.currentTime}</output>
    <output data-testid="playing">{String(playback.playing)}</output></div>;
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  jest.useFakeTimers(); jest.replaceProperty(Platform, 'OS', 'web');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mockPlayers.length = 0; mockPlayerHookRenders.mockClear();
  jest.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(8529);
  jest.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play')); return Promise.resolve();
  });
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  jest.useRealTimers(); jest.restoreAllMocks();
});
it('keeps the real Expo VideoView attached to the same HTML video as playback progress rerenders its parent', async () => {
  const source = 'https://video.example.test/film?signature=first';
  await act(async () => root.render(<Harness source={source} />));
  const video = container.querySelector('video')!;
  await act(async () => { video.dispatchEvent(new Event('canplay')); jest.advanceTimersByTime(100); });
  expect(container.querySelector('button')!.disabled).toBe(false);
  const player = mockPlayers[0]!;
  const hookRenders = mockPlayerHookRenders.mock.calls.length;
  await act(async () => { container.querySelector('button')!.click(); });
  await act(async () => jest.advanceTimersByTime(100));
  expect(video.currentTime).toBe(201);
  expect(video.paused).toBe(false);
  expect(container.querySelector('[data-testid="playing"]')!.textContent).toBe('true');
  for (let tick = 0; tick < 30; tick++) {
    await act(async () => { video.currentTime += .1; jest.advanceTimersByTime(100); });
  }
  expect(container.querySelector('video')).toBe(video);
  expect(video.src).toBe(source);
  expect(video.currentTime).toBeGreaterThan(203);
  expect(video.paused).toBe(false);
  expect(player._mountedVideos.size).toBe(1);
  expect(player._mountedVideos.has(video)).toBe(true);
  expect(mockPlayers).toHaveLength(1);
  expect(mockPlayerHookRenders.mock.calls.length).toBe(hookRenders);

  await act(async () => root.render(<Harness source={source} expanded />));
  expect(container.querySelector('video')).toBe(video);
  expect(video.currentTime).toBeGreaterThan(203);
  expect(video.paused).toBe(false);
  await act(async () => root.render(<Harness source="https://video.example.test/film?signature=renewed" />));
  expect(container.querySelector('video')).not.toBe(video);
  expect(player._mountedVideos.size).toBe(0);
  expect(player.timeUpdateEventInterval).toBe(0);
});
