import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { FlatList } from 'react-native';
import { getSpeakingCatalogPlayback, getSpeakingPlayback } from '@/api/speaking';
import { registerAnonymous } from '@/api/practices';
import { requestSentenceTranslation } from '@/api/sentences';
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
jest.mock('@/api/sentences', () => ({ requestSentenceTranslation: jest.fn() }));
jest.mock('@/api/practices', () => ({ registerAnonymous: jest.fn() }));
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
  const { ShadowingVideoSubtitles } = jest.requireActual<typeof import('./ShadowingVideoSubtitles')>('./ShadowingVideoSubtitles');
  const MockMediaPlayer = ({ source, onController, onState, subtitleCue }: {
    source: string; onController: (controller: unknown) => void; onState: (state: ShadowingPlaybackState) => void;
    subtitleCue?: SpeakingMaterial['cues'][number] | null;
  }) => {
    React.useEffect(() => {
      mockReport = onState;
      mockPlayerState = { loaded: true, currentTime: 0, duration: 7200, playing: false, finished: false, error: '' };
      onController({ seek: mockSeek, play: mockPlay, pause: mockPause, setRate: jest.fn() }); onState(mockPlayerState);
      return () => { onController(null); };
    }, [source, onController, onState]);
    return React.createElement(React.Fragment, null, React.createElement(Text, { testID: 'media-source' }, source),
      React.createElement(ShadowingVideoSubtitles, { cue: subtitleCue ?? null, frameWidth: 640 }));
  };
  return { ShadowingVideo: MockMediaPlayer, ShadowingAudio: MockMediaPlayer };
});
const material: SpeakingMaterial = {
  id: 'forrest-gump-1994', title: '阿甘正传', subtitle: '电影对白', category: '电影对白', origin: 'platform', mediaType: 'video',
  duration: 7200, cues: [{ id: 'line-one', start: 0, end: 3, en: 'Hello there.', zh: '' }],
};
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-01T00:00:00Z')); jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(registerAnonymous).mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111', kind: 'guest', remainingFreePractices: 3 });
  jest.mocked(requestSentenceTranslation).mockResolvedValue('你好。');
  const store = emptySpeakingStore(); store.positions[material.id] = 45;
  jest.mocked(useSpeakingLibrary).mockReturnValue({ materials: [material], store, scope: 'speaking:v1:guest', cloud: false,
    loading: false, error: '', catalogError: '', loadingMore: false, moreError: '', hasMore: false, loadMore: jest.fn(), accept: jest.fn(), refresh: jest.fn() });
});
afterEach(() => { mockReport = undefined; mockDragChange = undefined; jest.useRealTimers(); });
function useImportedFilm() {
  const library = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  jest.mocked(useSpeakingLibrary).mockReturnValue({ ...library, cloud: true, scope: 'speaking:v1:account', materials: [{ ...material, origin: 'file', storage: 'cloud', assetId: '22222222-2222-4222-8222-222222222222' }] });
  jest.mocked(getSpeakingPlayback).mockResolvedValue({ url: 'https://r2.example.test/imported-film', expiresAt: '2026-10-01T01:00:00Z' });
}
it('shows bundled Chinese immediately in bilingual mode without authentication or translation calls', async () => {
  const library = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  jest.mocked(useSpeakingLibrary).mockReturnValue({ ...library, materials: [{ ...material, cues: [{ ...material.cues[0]!, zh: '预置中文译文。' }] }] });
  jest.mocked(getSpeakingCatalogPlayback).mockResolvedValue({ url: 'https://r2.example.test/film', expiresAt: '2026-10-01T01:00:00Z' });
  const view = await render(<ShadowingScreen />);
  expect(view.getByText('预置中文译文。')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(requestSentenceTranslation).not.toHaveBeenCalled();
  expect(registerAnonymous).not.toHaveBeenCalled();
  expect(view.queryByText('等待中文翻译…')).toBeNull();
  await view.unmount();
});
it('translates missing Chinese for imported films, switches transcript modes and reuses the cached result', async () => {
  useImportedFilm();
  const view = await render(<ShadowingScreen />);
  await act(async () => { jest.advanceTimersByTime(300); });
  await waitFor(() => expect(requestSentenceTranslation).toHaveBeenCalledTimes(1));
  expect(await view.findByText('你好。')).toBeTruthy();
  expect(requestSentenceTranslation).toHaveBeenCalledWith('Hello there.');
  const seeks = mockSeek.mock.calls.length;
  await fireEvent.press(view.getByLabelText(/^(字幕|台词)·双语$/));
  expect(view.queryByText('你好。')).toBeNull();
  await fireEvent.press(view.getByLabelText(/^(字幕|台词)·英文$/));
  expect(view.getByText('你好。')).toBeTruthy();
  expect(view.queryByLabelText('查词 Hello')).toBeNull();
  expect(mockSeek).toHaveBeenCalledTimes(seeks);
  await view.unmount();
  const reopened = await render(<ShadowingScreen />);
  expect(await reopened.findByText('你好。')).toBeTruthy();
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(1);
  await reopened.unmount();
});
it('shows a retry action when subtitle translation fails, then displays the recovered Chinese', async () => {
  useImportedFilm();
  jest.mocked(requestSentenceTranslation).mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValueOnce('你好。');
  const view = await render(<ShadowingScreen />);
  await act(async () => { jest.advanceTimersByTime(300); });
  await waitFor(() => expect(requestSentenceTranslation).toHaveBeenCalledTimes(1));
  await fireEvent.press(await view.findByLabelText('重试第 1 句翻译'));
  await act(async () => { jest.advanceTimersByTime(1100); });
  expect(await view.findByText('你好。')).toBeTruthy();
  expect(view.queryByLabelText('重试第 1 句翻译')).toBeNull();
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(2);
  await view.unmount();
});
it('syncs video subtitles to cue boundaries and toggles them independently of the transcript tools', async () => {
  jest.mocked(getSpeakingCatalogPlayback).mockResolvedValue({ url: 'https://r2.example.test/film', expiresAt: '2026-10-01T01:00:00Z' });
  const library = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  library.materials = [{ ...material, cues: [
    { id: 'first', start: 5, end: 8, en: 'Hello there.', zh: '你好。' },
    { id: 'second', start: 10, end: 12, en: 'See you soon.', zh: '' },
  ] }];
  library.store.positions[material.id] = 0;
  const view = await render(<ShadowingScreen />);
  const reportTime = async (currentTime: number, loaded = true) => act(async () => {
    mockPlayerState = { ...mockPlayerState, currentTime, loaded }; mockReport?.(mockPlayerState);
  });
  expect(view.getByRole('header', { name: '台词' })).toBeTruthy();
  expect(view.getByLabelText('字幕开启').props.accessibilityState.selected).toBe(true);
  expect(view.queryByTestId('video-subtitles')).toBeNull();
  await reportTime(5);
  expect(view.getByTestId('video-subtitle-en').props.children).toBe('Hello there.');
  expect(view.getByTestId('video-subtitle-zh').props.children).toBe('你好。');
  const seeks = mockSeek.mock.calls.length;
  const pauses = mockPause.mock.calls.length;
  await fireEvent.press(view.getByLabelText('字幕开启'));
  expect(view.getByLabelText('字幕关闭').props.accessibilityState.selected).toBe(false);
  expect(view.queryByTestId('video-subtitles')).toBeNull();
  expect(view.getByLabelText('跟读台词列表')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('字幕关闭'));
  expect(view.getByTestId('video-subtitle-en').props.children).toBe('Hello there.');
  expect(mockSeek).toHaveBeenCalledTimes(seeks);
  expect(mockPause).toHaveBeenCalledTimes(pauses);
  expect(getSpeakingCatalogPlayback).toHaveBeenCalledTimes(1);

  await fireEvent.press(view.getByLabelText('台词·双语'));
  await fireEvent.press(view.getByLabelText('台词·英文'));
  await fireEvent.press(view.getByLabelText('台词·中文'));
  expect(view.getByLabelText('台词·隐藏')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('遮挡板'));
  await fireEvent.press(view.getByLabelText('已收藏句'));
  await fireEvent.press(view.getByLabelText('查找'));
  await fireEvent.changeText(view.getByLabelText('查找台词'), 'no matching sentence');
  expect(view.getByTestId('video-subtitle-en').props.children).toBe('Hello there.');
  expect(view.getByTestId('video-subtitle-zh').props.children).toBe('你好。');
  await reportTime(8);
  expect(view.queryByTestId('video-subtitles')).toBeNull();
  await reportTime(10);
  expect(view.getByTestId('video-subtitle-en').props.children).toBe('See you soon.');
  expect(view.queryByTestId('video-subtitle-zh')).toBeNull();
  await reportTime(10, false);
  expect(view.queryByTestId('video-subtitles')).toBeNull();
  await reportTime(6);
  expect(view.getByTestId('video-subtitle-en').props.children).toBe('Hello there.');
  await reportTime(12);
  expect(view.queryByTestId('video-subtitles')).toBeNull();
  await view.unmount();
});
it('keeps transcript controls available for audio without offering a video subtitle toggle', async () => {
  const library = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  library.materials = [{ ...material, mediaType: 'audio' }];
  const view = await render(<ShadowingScreen />);
  expect(view.getByRole('header', { name: '台词' })).toBeTruthy();
  expect(view.getByLabelText('台词·双语')).toBeTruthy();
  expect(view.queryByLabelText('字幕开启')).toBeNull();
  expect(view.queryByLabelText('字幕关闭')).toBeNull();
  await view.unmount();
});
it.each([['word', 'Word'], ['markdown', 'Markdown']] as const)('exports the full transcript and saved notes from the more menu even with filtered or hidden subtitles (%s)', async (format, label) => {
  jest.mocked(getSpeakingCatalogPlayback).mockResolvedValue({ url: 'https://r2.example.test/film', expiresAt: '2026-10-01T00:10:00Z' });
  jest.mocked(exportSpeakingTranscript).mockResolvedValue(undefined);
  const library = jest.mocked(useSpeakingLibrary).getMockImplementation()!();
  library.store.notes[material.id] = { 'line-one': '注意连读' };
  const view = await render(<ShadowingScreen />);
  await fireEvent.press(view.getByLabelText('已收藏句'));
  await fireEvent.press(view.getByLabelText('遮挡板'));
  await fireEvent.press(view.getByLabelText('更多'));
  await fireEvent.press(view.getByLabelText(`导出 ${label} 台词本`));
  expect(exportSpeakingTranscript).toHaveBeenCalledWith(material, { 'line-one': '注意连读' }, format);
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
  expect(view.getByLabelText('跟读台词列表').props.scrollEnabled).toBe(true);
  await act(async () => { mockDragChange?.(true); });
  expect(mockSetOptions).toHaveBeenLastCalledWith({ fullScreenGestureEnabled: false, gestureEnabled: false });
  expect(view.getByLabelText('跟读台词列表').props.scrollEnabled).toBe(false);
  expect(view.getByLabelText('播放器与练习工具').props.scrollEnabled).toBe(false);
  await act(async () => { mockDragChange?.(false); });
  expect(mockSetOptions).toHaveBeenLastCalledWith({ fullScreenGestureEnabled: false, gestureEnabled: true });
  expect(view.getByLabelText('跟读台词列表').props.scrollEnabled).toBe(true);
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
