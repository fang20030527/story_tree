import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { getSpeakingCatalogPlayback, getSpeakingPlayback } from '@/api/speaking';
import { emptySpeakingStore, type SpeakingMaterial } from './model';
import type { ShadowingPlaybackState } from './playback';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { ShadowingScreen } from './ShadowingScreen';
import { exportSpeakingTranscript } from './transcriptExport';

let mockReport: ((state: ShadowingPlaybackState) => void) | undefined;
let mockPlayerState: ShadowingPlaybackState;
const mockSeek = jest.fn(async (time: number) => { mockPlayerState = { ...mockPlayerState, currentTime: time }; mockReport?.(mockPlayerState); });
const mockPlay = jest.fn(() => { mockPlayerState = { ...mockPlayerState, playing: true }; mockReport?.(mockPlayerState); });
const mockPause = jest.fn(() => { mockPlayerState = { ...mockPlayerState, playing: false }; mockReport?.(mockPlayerState); });
const mockClose = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({ id: 'forrest-gump-1994' }),
  useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('@/features/editorial/EditorialAudioProvider', () => ({ useEditorialAudio: () => ({ close: mockClose }) }));
jest.mock('@/api/speaking', () => ({ getSpeakingCatalogPlayback: jest.fn(), getSpeakingPlayback: jest.fn() }));
jest.mock('./useSpeakingLibrary', () => ({ useSpeakingLibrary: jest.fn() }));
jest.mock('./transcriptExport', () => ({ exportSpeakingTranscript: jest.fn() }));
jest.mock('./useSpeakingSession', () => ({ useSpeakingSession: () => ({ error: '', save: jest.fn() }) }));
jest.mock('./ShadowingRecording', () => ({ ShadowingRecording: () => null }));
jest.mock('./ShadowingSettings', () => ({ ShadowingSettings: () => null }));
jest.mock('./ShadowingProgress', () => ({ ShadowingProgress: () => null }));
jest.mock('./ShadowingDictionary', () => ({ ShadowingDictionary: () => null }));
jest.mock('./SpeakingComponents', () => ({ SpeakingHeader: () => null, SpeakingStatus: () => null, speakingStyles: {} }));
jest.mock('./ShadowingMedia', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const MockMediaPlayer = ({ source, onController, onState }: {
    source: string; onController: (controller: unknown) => void; onState: (state: ShadowingPlaybackState) => void;
  }) => {
    React.useEffect(() => {
      mockReport = onState;
      mockPlayerState = { loaded: true, currentTime: 0, duration: 7200, playing: false, finished: false, error: '' };
      onController({ seek: mockSeek, play: mockPlay, pause: mockPause, setRate: jest.fn() }); onState(mockPlayerState);
      return () => { onController(null); };
    }, [source, onController, onState]);
    return React.createElement(Text, { testID: 'media-source' }, source);
  };
  return { ShadowingVideo: MockMediaPlayer, ShadowingAudio: MockMediaPlayer };
});
const material: SpeakingMaterial = {
  id: 'forrest-gump-1994', title: '阿甘正传', subtitle: '电影对白', category: '电影对白', origin: 'platform', mediaType: 'video',
  duration: 7200, cues: [{ id: 'line-one', start: 0, end: 3, en: 'Hello there.', zh: '' }],
};
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-01T00:00:00Z')); jest.clearAllMocks();
  const store = emptySpeakingStore(); store.positions[material.id] = 45;
  jest.mocked(useSpeakingLibrary).mockReturnValue({ materials: [material], store, scope: 'speaking:v1:guest', cloud: false,
    loading: false, error: '', catalogError: '', loadingMore: false, moreError: '', hasMore: false, loadMore: jest.fn(), accept: jest.fn(), refresh: jest.fn() });
});
afterEach(() => { mockReport = undefined; jest.useRealTimers(); });
it('exports the full transcript and saved notes from the more menu even with filtered or hidden subtitles', async () => {
  jest.mocked(getSpeakingCatalogPlayback).mockResolvedValue({ url: 'https://r2.example.test/film', expiresAt: '2026-10-01T00:10:00Z' });
  jest.mocked(exportSpeakingTranscript).mockResolvedValue(undefined);
  const library = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  library.store.notes[material.id] = { 'line-one': '注意连读' };
  const view = await render(<ShadowingScreen />);
  await fireEvent.press(view.getByLabelText('已收藏句'));
  await fireEvent.press(view.getByLabelText('遮挡板'));
  await fireEvent.press(view.getByLabelText('更多'));
  await fireEvent.press(view.getByLabelText('导出 Word 台词本'));
  expect(exportSpeakingTranscript).toHaveBeenCalledWith(material, { 'line-one': '注意连读' }, 'word');
  await view.unmount();
});
it('plays a public film for a guest and renews its signed URL while restoring playback position', async () => {
  jest.mocked(getSpeakingCatalogPlayback)
    .mockResolvedValueOnce({ url: 'https://r2.example.test/film?signature=first', expiresAt: '2026-10-01T00:10:00Z' })
    .mockResolvedValueOnce({ url: 'https://r2.example.test/film?signature=renewed', expiresAt: '2026-10-01T00:20:00Z' });
  const view = await render(<ShadowingScreen />);
  await waitFor(() => expect(view.getByTestId('media-source').props.children).toContain('signature=first'));
  await waitFor(() => expect(mockSeek).toHaveBeenCalledWith(45));
  await fireEvent.press(view.getByLabelText('播放原音'));
  await act(async () => {
    mockPlayerState = { ...mockPlayerState, currentTime: 68, playing: true }; mockReport?.(mockPlayerState);
  });
  await act(async () => { jest.advanceTimersByTime(585_000); });
  await waitFor(() => expect(view.getByTestId('media-source').props.children).toContain('signature=renewed'));
  await waitFor(() => expect(mockSeek).toHaveBeenLastCalledWith(68));
  expect(mockPlay).toHaveBeenCalledTimes(2);
  expect(getSpeakingCatalogPlayback).toHaveBeenNthCalledWith(2, material.id);
  expect(getSpeakingPlayback).not.toHaveBeenCalled();
  await view.unmount();
});
