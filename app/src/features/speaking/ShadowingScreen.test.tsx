import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { FlatList } from 'react-native';
import { getSpeakingCatalogPlayback, getSpeakingPlayback } from '@/api/speaking';
import { emptySpeakingStore, type SpeakingMaterial } from './model';
import type { ShadowingPlaybackState } from './playback';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { ShadowingScreen } from './ShadowingScreen';
import { exportSpeakingTranscript } from './transcriptExport';
import { saveSpeakingMaterialState } from './cloudSync';

let mockReport: ((state: ShadowingPlaybackState) => void) | undefined;
let mockPlayerState: ShadowingPlaybackState;
const mockSeek = jest.fn(async (time: number) => { mockPlayerState = { ...mockPlayerState, currentTime: time }; mockReport?.(mockPlayerState); });
const mockPlay = jest.fn(() => { mockPlayerState = { ...mockPlayerState, playing: true }; mockReport?.(mockPlayerState); });
const mockPause = jest.fn(() => { mockPlayerState = { ...mockPlayerState, playing: false }; mockReport?.(mockPlayerState); });
const mockClose = jest.fn();
const mockSetOptions = jest.fn();
const mockNavigation = { setOptions: mockSetOptions };
let mockDragChange: ((dragging: boolean) => void) | undefined;
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({ id: 'forrest-gump-1994' }), useNavigation: () => mockNavigation,
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
jest.mock('./ShadowingProgress', () => ({ ShadowingProgress: ({ onDragChange }: { onDragChange?: (dragging: boolean) => void }) => { mockDragChange = onDragChange; return null; } }));
jest.mock('./cloudSync', () => ({ saveSpeakingMaterialState: jest.fn() }));
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
afterEach(() => { mockReport = undefined; mockDragChange = undefined; jest.useRealTimers(); });
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
const failPlayer = async (message = '视频播放失败，请重试') => act(async () => {
  mockPlayerState = { ...mockPlayerState, playing: false, error: message }; mockReport?.(mockPlayerState);
});
it('keeps the public film player alive past the old timer and renews the expired URL only after a player error', async () => {
  jest.mocked(getSpeakingCatalogPlayback)
    .mockResolvedValueOnce({ url: 'https://r2.example.test/film?signature=first', expiresAt: '2026-10-01T01:00:00Z' })
    .mockResolvedValueOnce({ url: 'https://r2.example.test/film?signature=renewed', expiresAt: '2026-10-01T02:01:00Z' });
  const view = await render(<ShadowingScreen />);
  await waitFor(() => expect(view.getByTestId('media-source').props.children).toContain('signature=first'));
  await waitFor(() => expect(mockSeek).toHaveBeenCalledWith(45));
  await fireEvent.press(view.getByLabelText('播放原音'));
  await act(async () => {
    mockPlayerState = { ...mockPlayerState, currentTime: 68, playing: true }; mockReport?.(mockPlayerState);
  });
  // 旧实现在 585s 时销毁重建播放器；现在链接过期前后都不应因定时器重新取链。
  await act(async () => { jest.advanceTimersByTime(3_660_000); });
  expect(getSpeakingCatalogPlayback).toHaveBeenCalledTimes(1);
  expect(view.getByTestId('media-source').props.children).toContain('signature=first');

  await failPlayer();
  await waitFor(() => expect(view.getByTestId('media-source').props.children).toContain('signature=renewed'));
  await waitFor(() => expect(mockSeek).toHaveBeenLastCalledWith(68));
  expect(mockPlay).toHaveBeenCalledTimes(2);
  expect(getSpeakingCatalogPlayback).toHaveBeenCalledTimes(2);
  expect(getSpeakingCatalogPlayback).toHaveBeenNthCalledWith(2, material.id);
  expect(getSpeakingPlayback).not.toHaveBeenCalled();
  expect(view.queryByRole('alert')).toBeNull();
  await view.unmount();
});
it('auto-renews a valid URL once after a player error, then leaves further retries to the user', async () => {
  jest.mocked(getSpeakingCatalogPlayback)
    .mockResolvedValueOnce({ url: 'https://r2.example.test/film?signature=first', expiresAt: '2026-10-01T01:00:00Z' })
    .mockResolvedValueOnce({ url: 'https://r2.example.test/film?signature=second', expiresAt: '2026-10-01T01:00:00Z' })
    .mockResolvedValueOnce({ url: 'https://r2.example.test/film?signature=third', expiresAt: '2026-10-01T01:00:00Z' });
  const view = await render(<ShadowingScreen />);
  await waitFor(() => expect(view.getByTestId('media-source').props.children).toContain('signature=first'));
  await waitFor(() => expect(mockSeek).toHaveBeenCalledWith(45));
  await act(async () => { mockPlayerState = { ...mockPlayerState, currentTime: 120 }; mockReport?.(mockPlayerState); });
  await failPlayer();
  await waitFor(() => expect(view.getByTestId('media-source').props.children).toContain('signature=second'));
  await waitFor(() => expect(mockSeek).toHaveBeenLastCalledWith(120));

  await failPlayer();
  expect(await view.findByRole('alert')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(getSpeakingCatalogPlayback).toHaveBeenCalledTimes(2);
  expect(view.getByTestId('media-source').props.children).toContain('signature=second');

  await fireEvent.press(view.getByText('重试音视频'));
  await waitFor(() => expect(view.getByTestId('media-source').props.children).toContain('signature=third'));
  expect(getSpeakingCatalogPlayback).toHaveBeenCalledTimes(3);
  await view.unmount();
});

it('pauses swipe-back and transcript scrolling while the seek bar is dragged', async () => {
  jest.mocked(getSpeakingCatalogPlayback).mockResolvedValue({ url: 'https://r2.example.test/film', expiresAt: '2026-10-01T01:00:00Z' });
  const view = await render(<ShadowingScreen />);
  // iOS 26 默认全屏侧滑返回：本页始终只保留边缘返回。
  expect(mockSetOptions).toHaveBeenLastCalledWith({ fullScreenGestureEnabled: false, gestureEnabled: true });
  expect(view.getByLabelText('跟读字幕列表').props.scrollEnabled).toBe(true);
  await act(async () => { mockDragChange?.(true); });
  expect(mockSetOptions).toHaveBeenLastCalledWith({ fullScreenGestureEnabled: false, gestureEnabled: false });
  expect(view.getByLabelText('跟读字幕列表').props.scrollEnabled).toBe(false);
  expect(view.getByLabelText('播放器与练习工具').props.scrollEnabled).toBe(false);
  await act(async () => { mockDragChange?.(false); });
  expect(mockSetOptions).toHaveBeenLastCalledWith({ fullScreenGestureEnabled: false, gestureEnabled: true });
  expect(view.getByLabelText('跟读字幕列表').props.scrollEnabled).toBe(true);
  await view.unmount();
});
function useStatefulLibrary() {
  const initial = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  jest.mocked(useSpeakingLibrary).mockImplementation(function useMockSpeakingLibrary() {
    const [store, setStore] = React.useState(initial.store);
    return { ...initial, store, accept: setStore };
  });
}
it('bookmarks the sentence being practiced from the footer and shows it immediately', async () => {
  jest.mocked(getSpeakingCatalogPlayback).mockResolvedValue({ url: 'https://r2.example.test/film', expiresAt: '2026-10-01T01:00:00Z' });
  useStatefulLibrary();
  let finish!: () => void;
  jest.mocked(saveSpeakingMaterialState).mockImplementation((_material, _scope, input) => new Promise(resolve => {
    finish = () => {
      const store = emptySpeakingStore();
      const patch = typeof input === 'function' ? input(store) : input;
      store.saved[material.id] = patch.savedCueIds ?? [];
      resolve(store);
    };
  }));
  const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  const view = await render(<ShadowingScreen />);
  await act(async () => { jest.advanceTimersByTime(500); });
  const scrolls = scrollToIndex.mock.calls.length;
  await fireEvent.press(view.getByLabelText('收藏当前句'));
  // 云端写入尚未完成时，底部操作和列表里的书签都已显示为已收藏。
  expect(view.getByLabelText('取消收藏当前句')).toBeTruthy();
  expect(view.getByLabelText('取消收藏第 1 句')).toBeTruthy();
  expect(saveSpeakingMaterialState).toHaveBeenCalledWith(material, 'speaking:v1:guest', expect.any(Function));
  await act(async () => { finish(); });
  expect(view.getByLabelText('取消收藏当前句').props.accessibilityState).toMatchObject({ selected: true });
  expect(view.queryByRole('alert')).toBeNull();
  // 收藏不会触发自动滚动把字幕列表拉回当前句。
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(scrollToIndex).toHaveBeenCalledTimes(scrolls);
  scrollToIndex.mockRestore();
  await view.unmount();
});
it('reverts an optimistic bookmark and explains why when saving fails', async () => {
  jest.mocked(getSpeakingCatalogPlayback).mockResolvedValue({ url: 'https://r2.example.test/film', expiresAt: '2026-10-01T01:00:00Z' });
  useStatefulLibrary();
  jest.mocked(saveSpeakingMaterialState).mockRejectedValue(new Error('网络不可用'));
  const view = await render(<ShadowingScreen />);
  await fireEvent.press(view.getByLabelText('收藏第 1 句'));
  expect(await view.findByText('收藏保存失败：网络不可用')).toBeTruthy();
  expect(view.getByLabelText('收藏当前句')).toBeTruthy();
  expect(view.getByLabelText('收藏第 1 句')).toBeTruthy();
  await view.unmount();
});
