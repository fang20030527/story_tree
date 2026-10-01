import { act, render } from '@testing-library/react-native';
import React from 'react';
import { Platform, Text, View } from 'react-native';
import type VideoPlayerWeb from 'expo-video/build/VideoPlayer.web';
import { ShadowingVideo } from './ShadowingMedia';
import { useShadowingPlayback } from './useShadowingPlayback';

type MockVideo = { currentTime: number; duration: number; paused: boolean };
const mockPlayers: VideoPlayerWeb[] = [];
const mockVideos = new Map<VideoPlayerWeb, MockVideo>();
const mockRenders = jest.fn();
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]) }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('expo-audio', () => ({ useAudioPlayer: jest.fn(), useAudioPlayerStatus: jest.fn(), setAudioModeAsync: jest.fn() }));
jest.mock('expo-video', () => {
  // Exercise the installed SDK's source memoization, timer and EventEmitter.
  // Only the HTML element is replaced, since the native test renderer has no DOM.
  const sdk = jest.requireActual<typeof import('expo-video/build/VideoPlayer.web')>('expo-video/build/VideoPlayer.web');
  const React = jest.requireActual<typeof import('react')>('react');
  const VideoView = ({ player }: { player: VideoPlayerWeb }) => {
    React.useEffect(() => {
      if (!mockPlayers.includes(player)) mockPlayers.push(player);
      const video = {
        currentTime: 0, duration: NaN, paused: true, readyState: 4, volume: 1, muted: false, playbackRate: 1,
        buffered: { length: 0 }, play: jest.fn(), pause: jest.fn(),
      };
      mockVideos.set(player, video);
      player.mountVideoView(video as unknown as HTMLVideoElement);
      return () => { player.unmountVideoView(video as unknown as HTMLVideoElement); };
    }, [player]);
    return null;
  };
  return { ...sdk, VideoView };
});
const cues = [{ id: 'one', start: 0, end: 3, en: 'Hello.', zh: '' }];
function Harness({ source }: { source: string }) {
  const playback = useShadowingPlayback(cues);
  mockRenders();
  if (mockRenders.mock.calls.length > 30) throw new Error('Repeated equal player reports caused a render feedback loop');
  return <View><ShadowingVideo source={source} title="Movie" expanded={false} onController={playback.onController}
    onState={value => playback.onState(value)} /><Text testID="position">{playback.currentTime}</Text>
    <Text testID="duration">{playback.duration}</Text><Text testID="loaded">{String(playback.loaded)}</Text></View>;
}
beforeEach(() => { jest.useFakeTimers(); jest.replaceProperty(Platform, 'OS', 'web'); mockPlayers.length = 0; mockVideos.clear(); mockRenders.mockClear(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
it('ignores identical Web SDK ticks while keeping real progress updates and cleaning up replaced players', async () => {
  const view = await render(<Harness source="https://video.example.test/film?signature=first" />);
  const first = mockPlayers[0]!;
  const initialRenders = mockRenders.mock.calls.length;
  for (let tick = 0; tick < 60; tick++) await act(async () => jest.advanceTimersByTime(100));
  expect(mockRenders.mock.calls.length).toBeLessThanOrEqual(initialRenders + 1);
  expect(mockPlayers).toHaveLength(1);
  expect(view.getByTestId('duration').props.children).toBe(0);
  expect(first.listenerCount('timeUpdate')).toBe(1);

  const video = mockVideos.get(first)!;
  video.duration = 8529; first._status = 'readyToPlay';
  await act(async () => jest.advanceTimersByTime(100));
  expect(view.getByTestId('duration').props.children).toBe(8529);
  expect(view.getByTestId('loaded').props.children).toBe('true');
  video.currentTime = 68; first.playing = true;
  await act(async () => jest.advanceTimersByTime(100));
  expect(view.getByTestId('position').props.children).toBe(68);
  const readyRenders = mockRenders.mock.calls.length;
  for (let tick = 0; tick < 60; tick++) await act(async () => jest.advanceTimersByTime(100));
  expect(mockRenders.mock.calls.length).toBeLessThanOrEqual(readyRenders + 1);
  expect(mockPlayers).toHaveLength(1);

  await view.rerender(<Harness source="https://video.example.test/film?signature=renewed" />);
  const next = mockPlayers[1]!;
  expect(mockPlayers).toHaveLength(2);
  expect(first.timeUpdateEventInterval).toBe(0);
  expect(first.listenerCount('timeUpdate')).toBe(0);
  expect(next.timeUpdateEventInterval).toBe(.1);
  expect(next.listenerCount('timeUpdate')).toBe(1);
  await view.unmount();
  expect(next.timeUpdateEventInterval).toBe(0);
  expect(next.listenerCount('timeUpdate')).toBe(0);
});
