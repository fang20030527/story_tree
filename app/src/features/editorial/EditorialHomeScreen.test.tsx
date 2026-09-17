import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { EditorialHomeScreen } from './EditorialHomeScreen';

jest.mock('@/features/practice/ContinuePracticeCard', () => ({ ContinuePracticeCard: () => null }));

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

beforeEach(() => jest.clearAllMocks());

it('shows only the approved discovery sections and opens an overview', async () => {
  const view = await render(<EditorialHomeScreen />);
  expect(view.getByText('外刊')).toBeTruthy();
  for (const section of ['今日精选', '精选外刊', '每日快讯', 'Kid News']) {
    expect(view.getByText(section)).toBeTruthy();
  }
  expect(view.getAllByText('更多')).toHaveLength(3);
  for (const forbidden of ['导入文章', '生词长文练习', '书籍', '活动', '学习讨论']) {
    expect(view.queryByText(forbidden)).toBeNull();
  }

  await fireEvent.press(
    view.getByLabelText('考古学家在 2.5 万年前牙齿中发现习惯性用药证据，查看文章概述'),
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/editorial/[id]',
    params: { id: 'hero' },
  });

  await fireEvent.press(view.getAllByText('更多')[0]!);
  expect(view.getByText('返回全部栏目')).toBeTruthy();
});

it('expands search and filters title, source, category, and no-result states', async () => {
  const view = await render(<EditorialHomeScreen />);
  await fireEvent.press(view.getByLabelText('搜索平台外刊'));
  const input = view.getByPlaceholderText('搜索中英文标题、来源或分类');

  await fireEvent.changeText(input, 'BBC Future');
  expect(view.getByText('鹰与狼：爱尔兰地名里留存下来的失落动物')).toBeTruthy();
  expect(view.queryByText('考古学家在 2.5 万年前牙齿中发现习惯性用药证据')).toBeNull();

  await fireEvent.changeText(input, '动物');
  expect(view.getByText('对付斑衣蜡蝉的意外秘密武器')).toBeTruthy();

  await fireEvent.changeText(input, 'no such article');
  expect(view.getByText('没有找到相关外刊')).toBeTruthy();
});

it.each([
  ['hero', '考古学家在 2.5 万年前牙齿中发现习惯性用药证据'],
  ['a1', '鹰与狼：爱尔兰地名里留存下来的失落动物'],
  ['n1', '通胀在全球回归，抗通胀之战也随之回来'],
  ['k1', '这只孤儿小象如何逆转发运'],
] as const)('opens %s through its overview', async (id, title) => {
  const view = await render(<EditorialHomeScreen />);
  await fireEvent.press(view.getByLabelText(`${title}，查看文章概述`));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/editorial/[id]',
    params: { id },
  });
});

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
