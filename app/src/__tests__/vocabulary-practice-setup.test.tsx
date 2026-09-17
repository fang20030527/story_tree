import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { ApiError } from '@/api/client';
import { createPractice, getDashboard, registerAnonymous } from '@/api/practices';
import {
  clearCreatePracticeOperation,
  hasConfirmedAge,
  loadCreatePracticeOperation,
  prepareCreatePracticeOperation,
  saveActivePracticeId,
  saveAgeConfirmation,
} from '@/features/practice/practiceStorage';

import { loadPracticeTargetCount } from '@/features/practice/practicePreferences';

import VocabularyPracticeSetupScreen from '../app/practice/from-vocabulary';

jest.mock('@/features/practice/practicePreferences', () => ({ loadPracticeTargetCount: jest.fn() }));
jest.mock('@/features/practice/PracticePreferencesCard', () => ({ PracticePreferencesCard: () => null }));
jest.mock('@/features/practice/ContinuePracticeCard', () => ({ ContinuePracticeCard: () => null }));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(() => callback(), [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/api/practices', () => ({
  createPractice: jest.fn(),
  getDashboard: jest.fn(),
  registerAnonymous: jest.fn(),
}));
jest.mock('@/features/practice/practiceStorage', () => ({
  PendingCreateOperationError: class PendingCreateOperationError extends Error {},
  clearCreatePracticeOperation: jest.fn(),
  hasConfirmedAge: jest.fn(),
  loadCreatePracticeOperation: jest.fn(),
  prepareCreatePracticeOperation: jest.fn(),
  saveActivePracticeId: jest.fn(),
  saveAgeConfirmation: jest.fn(),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: jest.requireActual('@/constants/theme').themes.light,
  }),
}));

const mockedCreatePractice = jest.mocked(createPractice);
const mockedGetDashboard = jest.mocked(getDashboard);
const mockedRegisterAnonymous = jest.mocked(registerAnonymous);
const mockedClearOperation = jest.mocked(clearCreatePracticeOperation);
const mockedHasConfirmedAge = jest.mocked(hasConfirmedAge);
const mockedLoadOperation = jest.mocked(loadCreatePracticeOperation);
const mockedPrepareOperation = jest.mocked(prepareCreatePracticeOperation);
const mockedSaveActivePracticeId = jest.mocked(saveActivePracticeId);

function dashboard(dueLearningCount = 5, unlearnedCount = 7) {
  return {
    incompletePracticeId: null,
    vocabularyCount: 60,
    reviewingCount: dueLearningCount,
    dueLearningCount,
    unlearnedCount,
    todayAddedCount: 2,
    completedPracticeCount: 1,
    remainingFreePractices: 3,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadPracticeTargetCount).mockResolvedValue(30);
  mockedHasConfirmedAge.mockResolvedValue(true);
  mockedLoadOperation.mockResolvedValue(null);
  mockedClearOperation.mockResolvedValue(undefined);
  mockedGetDashboard.mockResolvedValue(dashboard());
  mockedRegisterAnonymous.mockResolvedValue({
    userId: '11111111-1111-4111-8111-111111111111',
    kind: 'guest',
    remainingFreePractices: 3,
  });
  mockedPrepareOperation.mockImplementation(async (request) => ({
    request,
    idempotencyKey: 'random_vocabulary_key_123',
  }));
  mockedCreatePractice.mockResolvedValue({
    practiceId: '22222222-2222-4222-8222-222222222222',
    status: 'queued',
    remainingFreePractices: 2,
    pollAfterMs: 1_500,
  });
  mockedSaveActivePracticeId.mockResolvedValue(undefined);
});

it('only shows practice information on entry without creating a practice', async () => {
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('AI 阅读练习');
  expect(view.getByTestId('due-learning-count').props.children).toBe(5);
  expect(view.getByTestId('unlearned-count').props.children).toBe(7);
  expect(mockedCreatePractice).not.toHaveBeenCalled();
  expect(mockedPrepareOperation).not.toHaveBeenCalled();
  expect(view.getByText('开始多情景阅读练习')).toBeTruthy();
});

it('creates the practice with the saved count only after tapping start', async () => {
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('开始多情景阅读练习');
  expect(mockedCreatePractice).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('开始多情景阅读练习'));
  await waitFor(() => expect(mockedCreatePractice).toHaveBeenCalledWith(
    { source: 'vocabulary', format: 'topic_set', targetCount: 30 }, 'random_vocabulary_key_123',
  ));
  expect(mockedCreatePractice).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/practice/[id]/generating', params: {
    id: '22222222-2222-4222-8222-222222222222', origin: 'vocabulary',
  } });
});

it('shows an empty state without any request when no word can be selected', async () => {
  mockedGetDashboard.mockResolvedValue(dashboard(0, 0));
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('暂无可练习的单词');
  expect(view.queryByText('开始多情景阅读练习')).toBeNull();
  expect(mockedCreatePractice).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('录入新单词'));
  expect(router.push).toHaveBeenCalledWith('/practice/new');
});

it('keeps the original pending request even when the saved count has changed', async () => {
  const request = { source: 'vocabulary' as const, format: 'topic_set' as const, targetCount: 16 };
  mockedLoadOperation.mockResolvedValueOnce({ request, idempotencyKey: 'original-request-key' });
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('开始多情景阅读练习');
  await fireEvent.press(view.getByText('开始多情景阅读练习'));
  await waitFor(() => expect(mockedCreatePractice).toHaveBeenCalledWith(request, 'original-request-key'));
  expect(mockedPrepareOperation).not.toHaveBeenCalled();
});

it('requires the existing age confirmation before creation', async () => {
  mockedHasConfirmedAge.mockResolvedValue(false);
  jest.mocked(saveAgeConfirmation).mockResolvedValue();
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('开始多情景阅读练习');
  await fireEvent.press(view.getByText('开始多情景阅读练习'));
  await view.findByText('使用前请确认年龄');
  expect(mockedCreatePractice).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('我已年满 14 周岁'));
  await waitFor(() => expect(mockedCreatePractice).toHaveBeenCalledTimes(1));
});

it('does not silently generate with a different count when settings cannot load', async () => {
  jest.mocked(loadPracticeTargetCount).mockRejectedValueOnce(new Error('无法读取设置'));
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('开始多情景阅读练习');
  await fireEvent.press(view.getByText('开始多情景阅读练习'));
  await view.findByText('无法读取设置');
  expect(mockedCreatePractice).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('重试'));
  await waitFor(() => expect(mockedCreatePractice).toHaveBeenCalledTimes(1));
});

it('clears the retained operation after a non-retryable creation failure', async () => {
  mockedCreatePractice.mockRejectedValueOnce(new ApiError('INSUFFICIENT_VOCABULARY', '当前没有待复习单词', false));
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('开始多情景阅读练习');
  await fireEvent.press(view.getByText('开始多情景阅读练习'));
  await view.findByText('当前没有待复习单词');
  expect(mockedClearOperation).toHaveBeenCalledTimes(1);
});

it('offers a retry when the candidate counts fail to load', async () => {
  mockedGetDashboard.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(dashboard(3, 4));
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('暂时无法加载可练习单词数量');
  expect(view.queryByText('开始多情景阅读练习')).toBeNull();
  await fireEvent.press(view.getByText('重试'));
  await waitFor(() => expect(view.getByTestId('due-learning-count').props.children).toBe(3));
  expect(view.getByText('开始多情景阅读练习')).toBeTruthy();
});
