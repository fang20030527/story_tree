import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { getVocabulary } from '@/api/practices';

import WordsScreen from '../app/(tabs)/words';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(
      callback,
      [callback],
    ),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/api/practices', () => ({ getVocabulary: jest.fn() }));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: jest.requireActual('@/constants/theme').themes.light,
  }),
}));

const mockedGetVocabulary = jest.mocked(getVocabulary);

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetVocabulary.mockResolvedValue({ items: [], nextCursor: null });
});

it('opens random vocabulary setup from the practice button only', async () => {
  const view = await render(<WordsScreen />);
  await waitFor(() => expect(view.getByText('还没有云端生词')).toBeTruthy());

  await fireEvent.press(view.getByText('创建长文练习'));
  expect(router.push).toHaveBeenLastCalledWith('/practice/from-vocabulary');

  await fireEvent.press(view.getByLabelText('录入新词义'));
  expect(router.push).toHaveBeenLastCalledWith('/practice/new');
});
