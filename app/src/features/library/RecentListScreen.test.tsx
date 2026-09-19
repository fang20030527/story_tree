import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { router } from 'expo-router';

import { RecentListScreen } from './RecentListScreen';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

it('routes editorial and imported recent rows to their respective readers', async () => {
  const load = jest.fn().mockResolvedValue([
    {
      kind: 'editorial',
      articleId: 'hero',
      timestamp: '2026-09-12T09:00:00.000Z',
    },
    {
      kind: 'imported',
      articleId: '11111111-1111-4111-8111-111111111111',
      title: 'Private article',
      sourceKind: 'paste',
      wordCount: 800,
      timestamp: '2026-09-12T08:00:00.000Z',
    },
  ]);
  const view = await render(<RecentListScreen load={load} />);

  await waitFor(() => expect(view.getByText('Private article')).toBeTruthy());
  await fireEvent.press(view.getByText('拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/editorial/[id]/read',
    params: { id: 'hero' },
  });
  await fireEvent.press(view.getByText('Private article'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/article-read',
    params: { id: '11111111-1111-4111-8111-111111111111' },
  });
});

it('uses a discriminated removal key and confirms clearing', async () => {
  const entry = {
    kind: 'editorial' as const,
    articleId: 'hero',
    timestamp: '2026-09-12T09:00:00.000Z',
  };
  const load = jest.fn().mockResolvedValue([entry]);
  const remove = jest.fn().mockResolvedValue(undefined);
  const clear = jest.fn().mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(
    <RecentListScreen load={load} remove={remove} clear={clear} />,
  );

  await waitFor(() => expect(view.getByText('清空')).toBeTruthy());
  await fireEvent.press(view.getByText('清空'));
  expect(alert).toHaveBeenCalledWith(
    '清空最近观看',
    expect.any(String),
    expect.any(Array),
  );
  await fireEvent.press(view.getByLabelText('删除这条记录'));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('editorial:hero'));
  alert.mockRestore();
});
