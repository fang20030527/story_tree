import { EditorialAudioPlayer } from './EditorialAudioPlayer';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import {
  isEditorialArticleShelved,
  setEditorialArticleShelved,
} from '@/features/shelf/editorialShelfStorage';

import { EditorialOverviewScreen } from './EditorialOverviewScreen';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));
jest.mock('@/features/shelf/editorialShelfStorage', () => ({
  isEditorialArticleShelved: jest.fn(),
  setEditorialArticleShelved: jest.fn(),
}));

const mockedIsShelved = jest.mocked(isEditorialArticleShelved);
const mockedSetShelved = jest.mocked(setEditorialArticleShelved);

beforeEach(() => {
  jest.clearAllMocks();
  mockedIsShelved.mockResolvedValue(false);
  mockedSetShelved.mockResolvedValue(undefined);
});

it('uses explicit text state and keeps start reading independent', async () => {
  const view = await render(<EditorialOverviewScreen articleId="hero" />);
  await waitFor(() => expect(view.getByText('加入书架')).toBeTruthy());

  await fireEvent.press(view.getByText('加入书架'));
  await waitFor(() => expect(view.getByText('✓ 已加入')).toBeTruthy());
  expect(mockedSetShelved).toHaveBeenCalledWith('hero', true);

  await fireEvent.press(view.getByText('开始阅读'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/editorial/[id]/read',
    params: { id: 'hero' },
  });
  expect(mockedSetShelved).toHaveBeenCalledTimes(1);

  await fireEvent.press(view.getByText('✓ 已加入'));
  await waitFor(() => expect(view.getByText('加入书架')).toBeTruthy());
  expect(mockedSetShelved).toHaveBeenLastCalledWith('hero', false);
});

it('rolls back a failed shelf write and exposes a retry message', async () => {
  mockedSetShelved.mockRejectedValueOnce(new Error('disk full'));
  const view = await render(<EditorialOverviewScreen articleId="hero" />);
  await waitFor(() => expect(view.getByText('加入书架')).toBeTruthy());
  await fireEvent.press(view.getByText('加入书架'));
  await waitFor(() =>
    expect(view.getByText('暂时无法更新书架，请重试')).toBeTruthy(),
  );
  expect(view.getByText('加入书架')).toBeTruthy();
});

it('shows a safe missing-article state', async () => {
  const view = await render(<EditorialOverviewScreen articleId="missing" />);
  expect(view.getByText('文章不存在')).toBeTruthy();
  expect(view.queryByText('开始阅读')).toBeNull();
  await fireEvent.press(view.getByText('返回外刊'));
  expect(router.replace).toHaveBeenCalledWith('/');
});

it('can replace a valid route ID with a missing ID without changing hook order', async () => {
  const view = await render(<EditorialOverviewScreen articleId="hero" />);
  await waitFor(() => expect(view.getByText('加入书架')).toBeTruthy());
  await expect(
    view.rerender(<EditorialOverviewScreen articleId="missing" />),
  ).resolves.toBeUndefined();
  expect(view.getByText('文章不存在')).toBeTruthy();
});

it('changes its accessible action label and blocks a pending shelf write', async () => {
  let resolveWrite!: () => void;
  mockedSetShelved.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
  );
  const view = await render(<EditorialOverviewScreen articleId="hero" />);
  await waitFor(() => expect(view.getByLabelText('加入书架')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('加入书架'));
  expect(view.getByLabelText('加入书架').props.accessibilityState).toMatchObject({
    disabled: true,
    busy: true,
  });
  await fireEvent.press(view.getByLabelText('加入书架'));
  expect(mockedSetShelved).toHaveBeenCalledTimes(1);
  resolveWrite();
  await waitFor(() => expect(view.getByLabelText('移出书架')).toBeTruthy());
});

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('./EditorialAudioPlayer', () => ({ EditorialAudioPlayer: jest.fn(() => null) }));

it('connects the supplied recording to the AI article', async () => {
  const view = await render(<EditorialOverviewScreen articleId="ai-arms-race" />);
  expect(view.getByText('Can the AI arms race be stopped?')).toBeTruthy();
  expect(EditorialAudioPlayer).toHaveBeenCalledWith(expect.objectContaining({ source: expect.anything() }), undefined);
});
