import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { createPractice, registerAnonymous } from '@/api/practices';
import { UNLISTED_MEANING_ZH } from '@/features/practice/practiceDraft';
import {
  loadVocabularyDraft,
  prepareCreatePracticeOperation,
  saveActivePracticeId,
  saveVocabularyDraft,
} from '@/features/practice/practiceStorage';

import NewPracticeScreen from '../app/practice/new';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn(), replace: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/api/practices', () => ({
  createPractice: jest.fn(),
  registerAnonymous: jest.fn(),
}));
jest.mock('@/features/practice/practiceStorage', () => ({
  ...jest.requireActual('@/features/practice/practiceStorage'),
  loadCreatePracticeOperation: jest.fn(),
  loadVocabularyDraft: jest.fn(),
  prepareCreatePracticeOperation: jest.fn(),
  saveActivePracticeId: jest.fn(),
  saveVocabularyDraft: jest.fn(),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));

const practiceId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadVocabularyDraft).mockResolvedValue([{ term: '', meaningZh: '', sourceSentence: '' }]);
  jest.mocked(saveVocabularyDraft).mockResolvedValue(undefined);
  jest.mocked(saveActivePracticeId).mockResolvedValue(undefined);
  jest.mocked(prepareCreatePracticeOperation).mockImplementation(async (request) => ({
    request, idempotencyKey: 'practice-new-test-key',
  }));
  jest.mocked(registerAnonymous).mockResolvedValue({
    userId: '11111111-1111-4111-8111-111111111111', kind: 'guest', remainingFreePractices: 3,
  });
  jest.mocked(createPractice).mockResolvedValue({ practiceId, status: 'queued', remainingFreePractices: 2 });
});

it('asks only for words and fills each meaning from the offline dictionary', async () => {
  const view = await render(<NewPracticeScreen />);
  const first = await view.findByLabelText('第 1 个单词或短语');
  expect(view.queryByText(/中文义项/)).toBeNull();

  await fireEvent.changeText(first, 'resilient');
  await fireEvent(first, 'blur');
  expect(await view.findByText(/有弹性的/)).toBeTruthy();

  await fireEvent.press(view.getByLabelText('添加一个单词'));
  const second = view.getByLabelText('第 2 个单词或短语');
  await fireEvent.changeText(second, 'qzxvbnm');
  await fireEvent(second, 'blur');
  expect(await view.findByText('词典未收录')).toBeTruthy();

  await fireEvent.press(view.getByLabelText('生成 4 篇主题短文'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({
    pathname: '/practice/[id]/generating', params: { id: practiceId },
  }));
  const request = jest.mocked(prepareCreatePracticeOperation).mock.calls[0][0];
  expect(request).toEqual({
    format: 'topic_set',
    items: [
      { term: 'resilient', meaningZh: expect.stringContaining('有弹性的') },
      { term: 'qzxvbnm', meaningZh: UNLISTED_MEANING_ZH },
    ],
  });
  expect(registerAnonymous).toHaveBeenCalledWith(true);
});

it('lets an unlisted word be removed before generating', async () => {
  jest.mocked(loadVocabularyDraft).mockResolvedValue([
    { term: 'lethal', meaningZh: '致命的', sourceSentence: 'A lethal dose.' },
    { term: 'qzxvbnm', meaningZh: '', sourceSentence: '' },
  ]);
  const view = await render(<NewPracticeScreen />);
  expect(await view.findByText('词典未收录')).toBeTruthy();
  expect(view.getByText('致命的')).toBeTruthy();

  await fireEvent.press(view.getByLabelText('删除第 2 个单词'));
  expect(view.queryByText('词典未收录')).toBeNull();

  await fireEvent.press(view.getByLabelText('生成 4 篇主题短文'));
  await waitFor(() => expect(createPractice).toHaveBeenCalled());
  expect(jest.mocked(prepareCreatePracticeOperation).mock.calls[0][0]).toEqual({
    format: 'topic_set',
    items: [{ term: 'lethal', meaningZh: '致命的', sourceSentence: 'A lethal dose.' }],
  });
});

it('moves to a new row on return and keeps the looked-up meaning', async () => {
  const view = await render(<NewPracticeScreen />);
  const first = await view.findByLabelText('第 1 个单词或短语');
  await fireEvent.changeText(first, 'mitigate');
  await fireEvent(first, 'submitEditing');

  expect(view.getByLabelText('第 2 个单词或短语')).toBeTruthy();
  expect(await view.findByText('使缓和；减轻（危害等）')).toBeTruthy();
  expect(view.getByText('1/10')).toBeTruthy();
});
