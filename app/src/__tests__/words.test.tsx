import type { DashboardDto } from '@context-reader/contracts';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { router } from 'expo-router';

import { ApiError } from '@/api/client';
import { getDashboard } from '@/api/practices';

import WordsScreen from '../app/(tabs)/words';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(() => callback(), [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/api/practices', () => ({ getDashboard: jest.fn() }));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));

const mockedGetDashboard = jest.mocked(getDashboard);

function dashboard(overrides: Partial<DashboardDto> = {}): DashboardDto {
  return {
    incompletePracticeId: null,
    vocabularyCount: 128,
    reviewingCount: 7,
    dueLearningCount: 7,
    unlearnedCount: 40,
    todayAddedCount: 3,
    completedPracticeCount: 2,
    remainingFreePractices: 3,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDashboard.mockResolvedValue(dashboard());
});

it('shows the two entries with whole-library counts and navigates to them', async () => {
  const view = await render(<WordsScreen />);
  await view.findByText('生词本');
  expect(view.getByTestId('total-word-count').props.children).toBe(128);
  expect(view.getByTestId('today-added-count').props.children).toBe(3);
  expect(view.getByTestId('due-learning-count').props.children).toBe(7);

  await fireEvent.press(view.getByLabelText('打开生词本'));
  expect(router.push).toHaveBeenLastCalledWith('/vocabulary/book');
  await fireEvent.press(view.getByLabelText('打开 AI 阅读练习'));
  expect(router.push).toHaveBeenLastCalledWith('/practice/from-vocabulary');
});

it('keeps both entries tappable when the counts fail to load and offers a retry', async () => {
  mockedGetDashboard.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络连接失败', true))
    .mockResolvedValueOnce(dashboard({ dueLearningCount: 11 }));
  const view = await render(<WordsScreen />);
  await view.findByText('网络连接失败');
  await fireEvent.press(view.getByText('重试'));
  await view.findByText('生词本');
  expect(view.getByTestId('due-learning-count').props.children).toBe(11);
  await fireEvent.press(view.getByLabelText('打开生词本'));
  expect(router.push).toHaveBeenLastCalledWith('/vocabulary/book');
});
