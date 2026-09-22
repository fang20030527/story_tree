import type { PracticeDto } from '@context-reader/contracts';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import TopicSelectionScreen from '@/app/practice/[id]/topics';
import GeneratingScreen from '@/app/practice/[id]/generating';
import { ApiError } from '@/api/client';
import { usePracticePolling } from '@/features/practice/usePracticePolling';
import { clearReadyPracticeCreation, saveActivePracticeId } from '@/features/practice/practiceStorage';

jest.mock('@/features/practice/usePracticeExitGuard', () => ({ usePracticeExitGuard: () => jest.requireActual('react').useCallback((action: () => void) => action(), []) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(),
  useFocusEffect: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));
jest.mock('@/features/practice/usePracticePolling', () => ({ usePracticePolling: jest.fn() }));
jest.mock('@/features/practice/practiceStorage', () => ({
  saveActivePracticeId: jest.fn(), clearActivePracticeId: jest.fn(),
  clearReadyPracticeCreation: jest.fn(), clearCreatePracticeOperation: jest.fn(),
}));

const groupId = '11111111-1111-4111-8111-111111111111';
const practice: PracticeDto = {
  id: groupId, status: 'ready', modelName: 'test', remainingFreePractices: 2,
  failure: null, article: null, questions: [],
  group: {
    id: groupId,
    articles: (['经济', '文化', '政治', '科技'] as const).map((topic, index) => ({
      id: `${index + 1}1111111-1111-4111-8111-111111111111`, topic,
      status: 'ready', title: `${topic} article`, wordCount: 250, failureMessage: null,
    })),
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: groupId });
  jest.mocked(usePracticePolling).mockReturnValue({ practice, error: null, retry: jest.fn() });
  jest.mocked(saveActivePracticeId).mockResolvedValue(undefined);
  jest.mocked(clearReadyPracticeCreation).mockResolvedValue(undefined);
});

it('shows four articles without navigating until the user chooses any topic', async () => {
  const view = await render(<TopicSelectionScreen />);
  for (const topic of ['经济', '文化', '政治', '科技']) expect(view.getAllByText(topic)).toHaveLength(2);
  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('科技，开始阅读'));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({
    pathname: '/practice/[id]/read', params: { id: practice.group!.articles[3]!.id },
  }));
  expect(saveActivePracticeId).toHaveBeenCalledWith(groupId);
  await fireEvent.press(view.getByLabelText('文化，开始阅读'));
  await waitFor(() => expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/practice/[id]/read', params: { id: practice.group!.articles[1]!.id },
  }));
});

it('keeps pending and failed cards visible while successful topics stay available', async () => {
  const mixed = structuredClone(practice);
  mixed.group!.articles[0]!.status = 'failed';
  mixed.group!.articles[0]!.failureMessage = '内容检查未通过';
  mixed.group!.articles[1]!.status = 'generating';
  mixed.group!.articles[2]!.status = 'completed';
  jest.mocked(usePracticePolling).mockReturnValue({ practice: mixed, error: null, retry: jest.fn() });
  const view = await render(<TopicSelectionScreen />);
  expect(view.getByText('内容检查未通过')).toBeTruthy();
  expect(view.getByText('1/4')).toBeTruthy();
  expect(view.getByLabelText('短文生成进度').props.accessibilityValue).toMatchObject({ min: 0, max: 4, now: 3 });
  expect(view.getByText('2 篇可阅读 · 1 篇未成功')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('文化，正在生成'));
  await fireEvent.press(view.getByLabelText('经济，生成未完成'));
  expect(router.push).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('科技，开始阅读'));
  await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
});

it('routes generation to topic selection even when the first article failed', async () => {
  jest.mocked(usePracticePolling).mockReturnValue({
    practice: { ...practice, status: 'failed' }, error: null, retry: jest.fn(),
  });
  await render(<GeneratingScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({
    pathname: '/practice/[id]/topics', params: { id: groupId },
  }));
  expect(router.replace).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/practice/[id]/read' }));
});


it('opens the first ready article while the other three are still generating', async () => {
  const partial = structuredClone(practice);
  partial.status = 'generating';
  partial.group!.articles.forEach((article, index) => { article.status = index === 2 ? 'ready' : 'generating'; });
  jest.mocked(usePracticePolling).mockReturnValue({ practice: partial, error: null, retry: jest.fn() });
  const view = await render(<TopicSelectionScreen />);
  expect(view.getByLabelText('短文生成进度').props.accessibilityValue.now).toBe(1);
  await fireEvent.press(view.getByLabelText('政治，开始阅读'));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/practice/[id]/read', params: { id: partial.group!.articles[2]!.id } }));
});

it('refreshes actual completion progress and marks stale status during a network error', async () => {
  const pending = structuredClone(practice);
  pending.group!.articles.forEach((article) => { article.status = 'queued'; });
  const retry = jest.fn();
  jest.mocked(usePracticePolling).mockReturnValue({ practice: pending, error: null, retry });
  const view = await render(<TopicSelectionScreen />);
  expect(view.getByText('0%')).toBeTruthy();

  pending.group!.articles[0]!.status = 'ready';
  pending.group!.articles[1]!.status = 'validating';
  pending.group!.articles[2]!.status = 'generating';
  await view.rerender(<TopicSelectionScreen />);
  expect(view.getByText('25%')).toBeTruthy();
  expect(view.getByLabelText('短文生成进度').props.accessibilityValue.now).toBe(1);

  jest.mocked(usePracticePolling).mockReturnValue({ practice: pending,
    error: new ApiError('NETWORK_ERROR', '网络暂时不可用', true), retry });
  await view.rerender(<TopicSelectionScreen />);
  expect(view.getByText('进度更新暂时中断，当前显示上次获取的状态。')).toBeTruthy();
  expect(view.getByText('25%')).toBeTruthy();
  await fireEvent.press(view.getByText('重新加载'));
  expect(retry).toHaveBeenCalled();

  jest.mocked(usePracticePolling).mockReturnValue({ practice, error: null, retry });
  await view.rerender(<TopicSelectionScreen />);
  expect(view.getByText('100%')).toBeTruthy();
  expect(view.getByText('四篇短文已生成')).toBeTruthy();
  expect(view.queryByText('进度更新暂时中断，当前显示上次获取的状态。')).toBeNull();
});

it('returns home by default when leaving topic selection', async () => {
  const view = await render(<TopicSelectionScreen />);
  await fireEvent.press(view.getByLabelText('返回首页'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
});

it('returns to the vocabulary practice entry when the group came from it', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: groupId, origin: 'vocabulary' });
  const view = await render(<TopicSelectionScreen />);
  await fireEvent.press(view.getByLabelText('返回首页'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/practice/from-vocabulary'));
});

it('threads the vocabulary origin from generation into topic selection', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: groupId, origin: 'vocabulary' });
  await render(<GeneratingScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({
    pathname: '/practice/[id]/topics', params: { id: groupId, origin: 'vocabulary' },
  }));
});
