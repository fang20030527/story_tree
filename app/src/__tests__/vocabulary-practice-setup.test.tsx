import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { ApiError } from '@/api/client';
import { createPractice, registerAnonymous } from '@/api/practices';
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

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/api/practices', () => ({
  createPractice: jest.fn(),
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
const mockedRegisterAnonymous = jest.mocked(registerAnonymous);
const mockedClearOperation = jest.mocked(clearCreatePracticeOperation);
const mockedHasConfirmedAge = jest.mocked(hasConfirmedAge);
const mockedLoadOperation = jest.mocked(loadCreatePracticeOperation);
const mockedPrepareOperation = jest.mocked(prepareCreatePracticeOperation);
const mockedSaveActivePracticeId = jest.mocked(saveActivePracticeId);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadPracticeTargetCount).mockResolvedValue(30);
  mockedHasConfirmedAge.mockResolvedValue(true);
  mockedLoadOperation.mockResolvedValue(null);
  mockedClearOperation.mockResolvedValue(undefined);
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


it('automatically uses the saved count without another input step', async () => {
  const view = await render(<VocabularyPracticeSetupScreen />);
  await waitFor(() => expect(mockedCreatePractice).toHaveBeenCalledWith(
    { source: 'vocabulary', format: 'topic_set', targetCount: 30 }, 'random_vocabulary_key_123',
  ));
  expect(view.queryByLabelText('练习目标词数')).toBeNull();
  expect(mockedCreatePractice).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/practice/[id]/generating', params: {
    id: '22222222-2222-4222-8222-222222222222', origin: 'vocabulary',
  } });
});
it('links to profile settings when the library cannot supply the requested words', async () => {
  mockedCreatePractice.mockRejectedValueOnce(new ApiError('INSUFFICIENT_VOCABULARY', '当前没有待复习单词', false));
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('当前没有待复习单词');
  expect(mockedClearOperation).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByText('前往“我的”调整练习数量'));
  expect(router.replace).toHaveBeenCalledWith('/(tabs)/profile');
});
it('keeps the original pending request even when the saved count has changed', async () => {
  const request = { source: 'vocabulary' as const, format: 'topic_set' as const, targetCount: 16 };
  mockedLoadOperation.mockResolvedValueOnce({ request, idempotencyKey: 'original-request-key' });
  await render(<VocabularyPracticeSetupScreen />);
  await waitFor(() => expect(mockedCreatePractice).toHaveBeenCalledWith(request, 'original-request-key'));
  expect(mockedPrepareOperation).not.toHaveBeenCalled();
});
it('requires the existing age confirmation before automatic creation', async () => {
  mockedHasConfirmedAge.mockResolvedValue(false);
  jest.mocked(saveAgeConfirmation).mockResolvedValue();
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('使用前请确认年龄');
  expect(mockedCreatePractice).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('我已年满 14 周岁'));
  await waitFor(() => expect(mockedCreatePractice).toHaveBeenCalledTimes(1));
});
it('does not silently generate with a different count when settings cannot load', async () => {
  jest.mocked(loadPracticeTargetCount).mockRejectedValueOnce(new Error('无法读取设置'));
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByText('无法读取设置');
  expect(mockedCreatePractice).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('重试'));
  await waitFor(() => expect(mockedCreatePractice).toHaveBeenCalledTimes(1));
});
