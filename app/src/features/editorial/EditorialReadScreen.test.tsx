import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadEditorialReadingProgress, saveEditorialReadingProgress } from './editorialReadingProgress';
import { createVocabularyItem, requestWordTranslation } from '@/api/practices';
import { requestSentenceTranslation } from '@/api/sentences';
import { AppState, ScrollView } from 'react-native';
import { EditorialAudioPlayer } from './EditorialAudioPlayer';
import { router } from 'expo-router';
import { markEditorialArticleRead } from './editorialReadStorage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { recordEditorialRecentView } from '@/features/library/libraryStorage';
import {
  isEditorialArticleShelved,
  setEditorialArticleShelved,
} from '@/features/shelf/editorialShelfStorage';

import { EditorialReadScreen } from './EditorialReadScreen';
import { getEditorialArticle } from './catalog';
import { loadEditorialTranslation } from './editorialTranslation';
import { themes } from '@/constants/theme';

jest.mock('@/features/study/useStudyTimer', () => ({ useStudyTimer: jest.fn() }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));
jest.mock('@/features/library/libraryStorage', () => ({
  recordEditorialRecentView: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/shelf/editorialShelfStorage', () => ({
  isEditorialArticleShelved: jest.fn(),
  setEditorialArticleShelved: jest.fn(),
}));

jest.mock('./editorialReadStorage', () => ({ markEditorialArticleRead: jest.fn() }));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/api/practices', () => ({ createVocabularyItem: jest.fn(), requestWordTranslation: jest.fn() }));
jest.mock('@/api/sentences', () => ({ requestSentenceTranslation: jest.fn() }));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(true);
  jest.mocked(markEditorialArticleRead).mockResolvedValue(undefined);
  jest.mocked(requestSentenceTranslation).mockResolvedValue('真实的中文译文。');
});

it('generates an actual Chinese full translation and reuses the saved result', async () => {
  const article = getEditorialArticle('hero')!;
  const first = await render(<EditorialReadScreen articleId="hero" />);
  await fireEvent.press(first.getByText('查看译文'));
  await waitFor(() => expect(first.getByText(/真实的中文译文。/u)).toBeTruthy());
  expect(requestSentenceTranslation).toHaveBeenCalled();
  expect(first.queryByText(/译文：Scarlet macaws/u)).toBeNull();
  const requestCount = jest.mocked(requestSentenceTranslation).mock.calls.length;
  await waitFor(async () => expect(await loadEditorialTranslation(article.id, article.paragraphs)).not.toBeNull());
  await first.unmount();
  const reopened = await render(<EditorialReadScreen articleId="hero" />);
  await waitFor(() => expect(reopened.getByText(/真实的中文译文。/u)).toBeTruthy());
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(requestCount);
});

it('renders catalog prose and records one editorial recent view', async () => {
  const view = await render(<EditorialReadScreen articleId="hero" />);
  expect(
    view.getByText('To save scarlet macaws, scientists are rescuing chicks from their lethal parents'),
  ).toBeTruthy();
  expect(
    view.getByText(/Parker hadn't even opened his eyes/u),
  ).toBeTruthy();
  await waitFor(() =>
    expect(recordEditorialRecentView).toHaveBeenCalledWith('hero'),
  );
  expect(isEditorialArticleShelved).not.toHaveBeenCalled();
  expect(setEditorialArticleShelved).not.toHaveBeenCalled();
});

it('does not record an invalid ID', async () => {
  const view = await render(<EditorialReadScreen articleId="missing" />);
  expect(view.getByText('文章不存在')).toBeTruthy();
  expect(recordEditorialRecentView).not.toHaveBeenCalled();
  expect(isEditorialArticleShelved).not.toHaveBeenCalled();
  expect(setEditorialArticleShelved).not.toHaveBeenCalled();
});


it('saves completion before leaving and prevents duplicate submissions', async () => {
  let finish!: () => void;
  jest.mocked(markEditorialArticleRead).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const view = await render(<EditorialReadScreen articleId="hero" />);
  expect(markEditorialArticleRead).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('完成学习'));
  await fireEvent.press(view.getByLabelText('完成学习'));
  expect(markEditorialArticleRead).toHaveBeenCalledTimes(1);
  expect(markEditorialArticleRead).toHaveBeenCalledWith('hero');
  expect(router.back).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('stays in the reader on save failure and allows retry', async () => {
  jest.mocked(markEditorialArticleRead).mockRejectedValueOnce(new Error('storage failed'));
  const view = await render(<EditorialReadScreen articleId="hero" />);
  await fireEvent.press(view.getByLabelText('完成学习'));
  expect(view.getByText('已读状态保存失败，请重试')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('完成学习'));
  expect(markEditorialArticleRead).toHaveBeenLastCalledWith('hero');
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('returns to the editorial list when opened without navigation history', async () => {
  jest.mocked(router.canGoBack).mockReturnValue(false);
  const view = await render(<EditorialReadScreen articleId="hero" />);
  await fireEvent.press(view.getByLabelText('完成学习'));
  expect(router.replace).toHaveBeenCalledWith('/');
});

jest.mock('./EditorialAudioPlayer', () => ({ EditorialAudioPlayer: jest.fn(() => null) }));
jest.mock('./EditorialSpeechPlayer', () => ({ EditorialSpeechPlayer: jest.fn(() => null) }));

it('connects the supplied recording to the AI article', async () => {
  const view = await render(<EditorialReadScreen articleId="ai-arms-race" />);
  expect(view.getByText('Can the AI arms race be stopped?')).toBeTruthy();
  expect(EditorialAudioPlayer).toHaveBeenCalledWith(expect.objectContaining({ source: expect.anything() }), undefined);
});

it('restores saved highlights, translation visibility and scroll position after leaving', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  await saveEditorialReadingProgress('hero', { addedWords: ['parker'], scrollY: 820, showFullTranslation: true });
  const view = await render(<EditorialReadScreen articleId="hero" />);
  await waitFor(() => expect(view.getByTestId('editorial-reading-scroll')).toBeTruthy());
  await waitFor(() => expect(view.getByTestId(`editorial-paragraph-${getEditorialArticle('hero')!.paragraphs.length - 1}`)).toBeTruthy());
  expect(view.getAllByText('Parker')[0]).toHaveStyle({ backgroundColor: '#F3BB31' });
  expect(view.getByText('隐藏译文')).toBeTruthy();
  const scroll = view.getByTestId('editorial-reading-scroll');
  await fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: 600 } } });
  await fireEvent(scroll, 'contentSizeChange', 390, 8000);
  expect(scrollTo).toHaveBeenCalledWith({ y: 820, animated: false });
  await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 1460 } } });
  await view.unmount();
  expect((await loadEditorialReadingProgress('hero')).scrollY).toBe(1460);
  const reopened = await render(<EditorialReadScreen articleId="hero" />);
  await waitFor(() => expect(reopened.getByTestId('editorial-reading-scroll')).toBeTruthy());
  await waitFor(() => expect(reopened.getByTestId(`editorial-paragraph-${getEditorialArticle('hero')!.paragraphs.length - 1}`)).toBeTruthy());
  await fireEvent(reopened.getByTestId('editorial-reading-scroll'), 'contentSizeChange', 390, 8000);
  await fireEvent(reopened.getByTestId('editorial-reading-scroll'), 'layout', { nativeEvent: { layout: { height: 600 } } });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1460, animated: false });
  expect(reopened.getAllByText('Parker')[0]).toHaveStyle({ backgroundColor: '#F3BB31' });
  scrollTo.mockRestore();
});

it('persists a successful vocabulary addition even if the reader was closed during the request', async () => {
  let finish!: () => void;
  jest.mocked(createVocabularyItem).mockReturnValueOnce(new Promise((resolve) => {
    finish = () => resolve({} as Awaited<ReturnType<typeof createVocabularyItem>>);
  }));
  const view = await render(<EditorialReadScreen articleId="hero" />);
  await waitFor(() => expect(view.getByTestId('editorial-reading-scroll')).toBeTruthy());
  jest.mocked(requestWordTranslation).mockResolvedValueOnce({ term: 'chicks', partOfSpeech: 'n.', meaningZh: '雏鸟', phoneticUk: '', phoneticUs: '' });
  await fireEvent.press(view.getAllByText('chicks')[0]);
  await fireEvent.press(view.getByLabelText('加入生词本'));
  await waitFor(() => expect(createVocabularyItem).toHaveBeenCalled());
  await view.unmount();
  await act(async () => finish());
  expect((await loadEditorialReadingProgress('hero')).addedWords).toContain('chicks');
});

it('does not overwrite existing progress when leaving before hydration finishes', async () => {
  await saveEditorialReadingProgress('hero', { scrollY: 1200, addedWords: ['scarlet'] });
  let finish!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<EditorialReadScreen articleId="hero" />);
  await view.unmount();
  await act(async () => finish(null));
  expect((await loadEditorialReadingProgress('hero')).scrollY).toBe(1200);
});

it('flushes the latest reading position when the app moves to the background', async () => {
  const listener = jest.mocked(AppState.addEventListener);
  const view = await render(<EditorialReadScreen articleId="hero" />);
  await waitFor(() => expect(view.getByTestId('editorial-reading-scroll')).toBeTruthy());
  await waitFor(() => expect(view.getByTestId(`editorial-paragraph-${getEditorialArticle('hero')!.paragraphs.length - 1}`)).toBeTruthy());
  const scroll = view.getByTestId('editorial-reading-scroll');
  await fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: 600 } } });
  await fireEvent(scroll, 'contentSizeChange', 390, 8000);
  await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 900 } } });
  await act(async () => listener.mock.calls[listener.mock.calls.length - 1][1]('background'));
  expect((await loadEditorialReadingProgress('hero')).scrollY).toBe(900);
});

it('allows retrying a failed load without overwriting saved progress', async () => {
  await saveEditorialReadingProgress('hero', { scrollY: 1500 });
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('read failure'));
  const view = await render(<EditorialReadScreen articleId="hero" />);
  await fireEvent.press(await view.findByText('阅读进度读取失败，请重试'));
  await waitFor(() => expect(view.getByTestId('editorial-reading-scroll')).toBeTruthy());
  expect((await loadEditorialReadingProgress('hero')).scrollY).toBe(1500);
});

it('highlights the spoken word, follows it, and lets manual scrolling suspend following', async () => {
  const article = getEditorialArticle('ai-arms-race')!;
  const first = article.audioCues![0]!;
  const second = article.audioCues![1]!;
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  const view = await render(<EditorialReadScreen articleId="ai-arms-race" />);
  const scroll = view.getByTestId('editorial-reading-scroll');
  await fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: 600 } } });
  await fireEvent(view.getByTestId('editorial-body'), 'layout', { nativeEvent: { layout: { y: 800 } } });
  await fireEvent(view.getByTestId('editorial-paragraph-0'), 'layout', { nativeEvent: { layout: { y: 0 } } });
  await fireEvent(view.getByText(/TWO THINGS should make/), 'textLayout', {
    nativeEvent: { lines: [{ text: article.paragraphs[0], y: 0, height: 30 }] },
  });
  const position = jest.mocked(EditorialAudioPlayer).mock.calls.at(-1)![0].onPositionChange!;
  await act(() => position({ currentTime: first[3], duration: 436.6, playing: true }));
  expect(view.getByText('TWO')).toHaveStyle({ color: themes.light.blue });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 602, animated: true });
  await fireEvent(scroll, 'scrollBeginDrag');
  scrollTo.mockClear();
  await act(() => position({ currentTime: second[3], duration: 436.6, playing: true }));
  expect(view.getByText('THINGS')).toHaveStyle({ color: themes.light.blue });
  expect(view.getByText('TWO')).toHaveStyle({ color: '#000000' });
  expect(scrollTo).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('恢复跟随朗读'));
  expect(scrollTo).toHaveBeenCalled();
  await act(() => position({ currentTime: first[3], duration: 436.6, playing: false }));
  expect(view.getByText('TWO')).toHaveStyle({ color: themes.light.blue });
  scrollTo.mockRestore();
});
it('renders all four original economic indicator charts', async () => {
  const articleId = 'economist-2026-09-19-0b132742-d39d-4c6b-86ad-d3a6c738c04b';
  const view = await render(
    <EditorialReadScreen articleId={articleId} />,
  );
  expect(view.getAllByLabelText(/Economic data, commodities and markets，原刊配图/)).toHaveLength(4);
});

it('shows the start of a long back-issue article before the whole body is mounted', async () => {
  const articleId = 'new-yorker-2026-07-20-a97e6e55e0285ff6';
  const article = getEditorialArticle(articleId)!;
  expect(article.bodyBlocks!.length).toBeGreaterThan(64);
  const view = await render(<EditorialReadScreen articleId={articleId} />);
  expect(view.getByTestId('editorial-paragraph-0')).toBeTruthy();
  expect(view.queryByTestId(`editorial-paragraph-${article.paragraphs.length - 1}`)).toBeNull();
  await view.unmount();
});
