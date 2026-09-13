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
} from '@/features/practice/practiceStorage';

import VocabularyPracticeSetupScreen from '../app/practice/from-vocabulary';

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

it('defaults to ten and submits only the adjusted target count', async () => {
  const view = await render(<VocabularyPracticeSetupScreen />);
  const countInput = await view.findByLabelText('练习目标词数');
  expect(countInput.props.value).toBe('10');

  await fireEvent.changeText(countInput, '16');
  await fireEvent.press(view.getByText('随机抽词并生成'));

  await waitFor(() => {
    expect(mockedPrepareOperation).toHaveBeenCalledWith({
      source: 'vocabulary',
      targetCount: 16,
    });
  });
  expect(mockedCreatePractice).toHaveBeenCalledWith(
    { source: 'vocabulary', targetCount: 16 },
    'random_vocabulary_key_123',
  );
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/practice/[id]/generating',
    params: {
      id: '22222222-2222-4222-8222-222222222222',
      origin: 'vocabulary',
    },
  });
});

it('shows the available count and unlocks adjustment after a rejected request', async () => {
  mockedCreatePractice.mockRejectedValueOnce(
    new ApiError(
      'INSUFFICIENT_VOCABULARY',
      '词库中只有 6 个待复习义项，请调低练习数量',
      false,
    ),
  );
  const view = await render(<VocabularyPracticeSetupScreen />);
  await view.findByLabelText('练习目标词数');

  await fireEvent.press(view.getByText('随机抽词并生成'));

  expect(
    await view.findByText('词库中只有 6 个待复习义项，请调低练习数量'),
  ).toBeTruthy();
  expect(mockedClearOperation).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
});
