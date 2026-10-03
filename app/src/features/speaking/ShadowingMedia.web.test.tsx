/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import type VideoPlayerWeb from 'expo-video/build/VideoPlayer.web';
import { ShadowingVideo } from './ShadowingMedia';
import { useShadowingPlayback } from './useShadowingPlayback';
import type { SpeakingCue } from './model';

const mockPlayers: VideoPlayerWeb[] = [];
const mockPlayerHookRenders = jest.fn();
jest.mock('react-native', () => jest.requireActual('react-native-web'));
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
function Harness({ source, expanded = false, subtitleCue = null }: { source: string; expanded?: boolean; subtitleCue?: SpeakingCue | null }) {
  const playback = useShadowingPlayback(cues);
  return <div><ShadowingVideo key={source} source={source} title="Movie" expanded={expanded}
    onController={playback.onController} onState={playback.onState} subtitleCue={subtitleCue} />
    <button onClick={() => void playback.seek(201, true)} disabled={!playback.loaded}>Play cue</button>
    <button data-testid="fullscreen" onClick={() => void playback.controller.current?.enterFullscreen?.()}>Fullscreen</button>
    <output data-testid="position">{playback.currentTime}</output>
    <output data-testid="playing">{String(playback.playing)}</output></div>;
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  jest.useFakeTimers(); jest.replaceProperty(Platform, 'OS', 'web');
  // jsdom 使用浏览器组件时无需 Expo 原生 fetch 的延迟初始化。
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: jest.fn() });
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
  Reflect.deleteProperty(document, 'fullscreenElement');
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
  expect(player._mountedVideos.has(video)).toBe(true);
  expect(player.duration).toBe(8529);

  const requestFullscreen = jest.fn(async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: video });
    video.dispatchEvent(new Event('fullscreenchange'));
  });
  Object.defineProperty(video, 'requestFullscreen', { configurable: true, value: requestFullscreen });
  const fullscreenPosition = video.currentTime;
  video.playbackRate = .75;
  expect(video.controls).toBe(false);
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="fullscreen"]')!.click(); });
  expect(requestFullscreen).toHaveBeenCalledTimes(1);
  expect(document.fullscreenElement).toBe(video);
  expect(video.controls).toBe(true);
  await act(async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    video.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(video.controls).toBe(false);
  expect(container.querySelector('video')).toBe(video);
  expect(video.currentTime).toBe(fullscreenPosition);
  expect(video.playbackRate).toBe(.75);
  expect(video.paused).toBe(false);
  expect(mockPlayers).toHaveLength(1);

  await act(async () => root.render(<Harness source="https://video.example.test/film?signature=renewed" />));
  expect(container.querySelector('video')).not.toBe(video);
  expect(player._mountedVideos.size).toBe(0);
  expect(player.timeUpdateEventInterval).toBe(0);
});
it('updates captions and enters fullscreen with the whole video frame while keeping playback mounted', async () => {
  const source = 'https://video.example.test/film';
  const first: SpeakingCue = { id: 'first', start: 201, end: 203, en: 'Hello there.', zh: '你好。' };
  const second: SpeakingCue = { id: 'second', start: 204, end: 207, en: 'See you soon.', zh: '' };
  await act(async () => root.render(<Harness source={source} subtitleCue={first} />));
  const video = container.querySelector('video')!;
  const frame = video.parentElement!;
  expect(video.style.width).toBe('100%');
  expect(video.style.height).toBe('100%');
  await act(async () => { video.dispatchEvent(new Event('canplay')); jest.advanceTimersByTime(100); });
  await act(async () => container.querySelector('button')!.click());
  video.playbackRate = .75;
  expect(frame.textContent).toContain('Hello there.');
  expect(frame.textContent).toContain('你好。');
  const player = mockPlayers[0]!;
  const expectPlaybackPreserved = () => {
    expect(container.querySelector('video')).toBe(video);
    expect(video.currentTime).toBe(201);
    expect(video.paused).toBe(false);
    expect(video.playbackRate).toBe(.75);
    expect(player._mountedVideos.has(video)).toBe(true);
    expect(mockPlayers).toHaveLength(1);
  };
  await act(async () => root.render(<Harness source={source} subtitleCue={second} />));
  expect(frame.textContent).toContain('See you soon.');
  expect(frame.textContent).not.toContain('Hello there.');
  expectPlaybackPreserved();
  await act(async () => root.render(<Harness source={source} />));
  expect(frame.textContent).not.toContain('See you soon.');
  expectPlaybackPreserved();
  await act(async () => root.render(<Harness source={source} subtitleCue={first} />));
  const requestFullscreen = jest.fn(async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: frame });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  Object.defineProperty(frame, 'requestFullscreen', { configurable: true, value: requestFullscreen });
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="fullscreen"]')!.click());
  expect(requestFullscreen).toHaveBeenCalledTimes(1);
  expect(document.fullscreenElement).toBe(frame);
  expect(frame.textContent).toContain('你好。');
  expect(video.controls).toBe(true);
  expectPlaybackPreserved();
  await act(async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(video.controls).toBe(false);
  expectPlaybackPreserved();
});
