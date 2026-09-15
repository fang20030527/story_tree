import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { router } from 'expo-router';

import { ShelfScreen } from './ShelfScreen';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

it('keeps local editorial items visible when cloud loading fails', async () => {
  const listImported = jest.fn().mockRejectedValue(new Error('offline'));
  const view = await render(<ShelfScreen dependencies={{
    loadEditorial: jest.fn().mockResolvedValue([
      { articleId: 'hero', addedAt: '2026-09-12T09:00:00.000Z' },
    ]),
    setEditorialShelved: jest.fn(), listImported,
    deleteImported: jest.fn(),
  }} />);
  await waitFor(() => expect(view.getByText('考古学家在 2.5 万年前牙齿中发现习惯性用药证据')).toBeTruthy());
  expect(view.getByText('暂时无法加载我的导入')).toBeTruthy();
  await fireEvent.press(view.getByText('重试'));
  expect(listImported).toHaveBeenCalledTimes(2);
});

const articleA = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceKind: 'paste' as const,
  sourceUrl: null,
  title: 'Private A',
  wordCount: 800,
  importedAt: '2026-09-11T08:00:00.000Z',
};
const articleB = {
  ...articleA,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Private B',
  importedAt: '2026-09-10T08:00:00.000Z',
};
const localHero = [
  { articleId: 'hero', addedAt: '2026-09-12T09:00:00.000Z' },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it('paginates, de-duplicates, filters, and opens each kind correctly', async () => {
  const listImported = jest.fn()
    .mockResolvedValueOnce({ items: [articleA], nextCursor: 'page-2' })
    .mockResolvedValueOnce({
      items: [{ ...articleA, title: 'Private A updated' }, articleB],
      nextCursor: null,
    });
  const view = await render(<ShelfScreen dependencies={{
    loadEditorial: jest.fn().mockResolvedValue(localHero),
    setEditorialShelved: jest.fn(), listImported,
    deleteImported: jest.fn(),
  }} />);

  await waitFor(() => expect(view.getByText('Private A')).toBeTruthy());
  await fireEvent(view.getByTestId('shelf-list'), 'endReached');
  await waitFor(() => expect(view.getByText('Private B')).toBeTruthy());
  expect(view.getAllByText(/Private A/u)).toHaveLength(1);
  expect(listImported).toHaveBeenLastCalledWith({
    limit: 30, cursor: 'page-2',
  });

  await fireEvent.press(view.getByText('平台外刊'));
  expect(view.getByText('考古学家在 2.5 万年前牙齿中发现习惯性用药证据')).toBeTruthy();
  expect(view.queryByText('Private B')).toBeNull();
  await fireEvent.press(view.getByText('我的导入'));
  expect(view.queryByText('考古学家在 2.5 万年前牙齿中发现习惯性用药证据')).toBeNull();
  await fireEvent.press(view.getByText('Private B'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/article-read', params: { id: articleB.id },
  });
  await fireEvent.press(view.getByText('全部'));
  await fireEvent.press(view.getByText('考古学家在 2.5 万年前牙齿中发现习惯性用药证据'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/editorial/[id]', params: { id: 'hero' },
  });
});

it('requires confirmation, waits for 204, and blocks duplicate deletes', async () => {
  const pending = deferred<void>();
  const deleteImported = jest.fn(() => pending.promise);
  const alert = jest.spyOn(Alert, 'alert');
  const view = await render(<ShelfScreen dependencies={{
    loadEditorial: jest.fn().mockResolvedValue([]),
    setEditorialShelved: jest.fn(),
    listImported: jest.fn().mockResolvedValue({ items: [articleA], nextCursor: null }),
    deleteImported,
  }} />);
  await waitFor(() => expect(view.getByText('Private A')).toBeTruthy());

  await fireEvent.press(view.getByLabelText('管理书架'));
  await fireEvent.press(view.getByLabelText('删除文章'));
  expect(deleteImported).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    '永久删除文章？',
    '正文和翻译将永久删除，无法恢复；已加入词库的词义和学习进度会保留。',
    expect.any(Array),
  );
  const buttons = alert.mock.calls[0]![2]!;
  const confirm = buttons.find((button) => button.style === 'destructive')!;
  confirm.onPress?.();
  confirm.onPress?.();
  expect(deleteImported).toHaveBeenCalledTimes(1);
  expect(view.getByText('Private A')).toBeTruthy();
  pending.resolve();
  await waitFor(() => expect(view.queryByText('Private A')).toBeNull());
});

it('keeps a private row after delete failure and allows retry', async () => {
  const deleteImported = jest.fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(undefined);
  const alert = jest.spyOn(Alert, 'alert');
  const view = await render(<ShelfScreen dependencies={{
    loadEditorial: jest.fn().mockResolvedValue([]),
    setEditorialShelved: jest.fn(),
    listImported: jest.fn().mockResolvedValue({ items: [articleA], nextCursor: null }),
    deleteImported,
  }} />);
  await waitFor(() => expect(view.getByText('Private A')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('管理书架'));
  await fireEvent.press(view.getByLabelText('删除文章'));
  alert.mock.calls.at(-1)![2]!
    .find((button) => button.style === 'destructive')!.onPress?.();
  await waitFor(() => expect(view.getByText('删除失败，请重试')).toBeTruthy());
  expect(view.getByText('Private A')).toBeTruthy();

  await fireEvent.press(view.getByLabelText('删除文章'));
  alert.mock.calls.at(-1)![2]!
    .find((button) => button.style === 'destructive')!.onPress?.();
  await waitFor(() => expect(view.queryByText('Private A')).toBeNull());
  expect(deleteImported).toHaveBeenCalledTimes(2);
});

it('opens the row menu before offering permanent deletion', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const deleteImported = jest.fn();
  const view = await render(<ShelfScreen dependencies={{
    loadEditorial: jest.fn().mockResolvedValue([]),
    setEditorialShelved: jest.fn(),
    listImported: jest.fn().mockResolvedValue({
      items: [articleA], nextCursor: null,
    }),
    deleteImported,
  }} />);
  await waitFor(() => expect(view.getByText('Private A')).toBeTruthy());

  await fireEvent.press(view.getByLabelText('Private A，更多操作'));
  expect(deleteImported).not.toHaveBeenCalled();
  expect(alert).toHaveBeenLastCalledWith(
    '我的导入',
    'Private A',
    expect.any(Array),
  );
  alert.mock.calls.at(-1)![2]!
    .find((button) => button.text === '删除文章')!.onPress?.();
  expect(alert).toHaveBeenLastCalledWith(
    '永久删除文章？',
    '正文和翻译将永久删除，无法恢复；已加入词库的词义和学习进度会保留。',
    expect.any(Array),
  );
});

it('removes an editorial row locally and shows the empty discovery action', async () => {
  const setEditorialShelved = jest.fn().mockResolvedValue(undefined);
  const loadEditorial = jest.fn()
    .mockResolvedValueOnce(localHero)
    .mockResolvedValueOnce([]);
  const view = await render(<ShelfScreen dependencies={{
    loadEditorial, setEditorialShelved,
    listImported: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    deleteImported: jest.fn(),
  }} />);
  await waitFor(() => expect(view.getByText('考古学家在 2.5 万年前牙齿中发现习惯性用药证据')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('管理书架'));
  expect(view.getByText('移出书架')).toBeTruthy();
  await fireEvent.press(view.getByText('移出书架'));
  await waitFor(() => expect(view.getByText('去外刊看看')).toBeTruthy());
  expect(setEditorialShelved).toHaveBeenCalledWith('hero', false);
  await fireEvent.press(view.getByText('去外刊看看'));
  expect(router.push).toHaveBeenCalledWith('/');
});
