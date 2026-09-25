import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { EditorialHomeScreen } from './EditorialHomeScreen';
import { getEditorialSection } from './catalog';

jest.mock('@/features/practice/ContinuePracticeCard', () => ({ ContinuePracticeCard: () => null }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
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
  for (const section of ['今日精选', '精选外刊']) {
    expect(view.getByText(section)).toBeTruthy();
  }
  expect(view.getByLabelText('查看The Economist')).toBeTruthy();
  expect(view.queryByText('年度最治愈直播：看瑞典北部驼鹿迁徙')).toBeNull();
  expect(view.queryByText('AI 正在如何改变语言学习的底层逻辑')).toBeNull();
  expect(view.queryByText('格洛丽亚·斯泰纳姆改变了美国女性的世界')).toBeNull();
  for (const forbidden of ['每日快讯', 'Kid News', '导入文章', '生词长文练习', '书籍', '活动', '学习讨论']) {
    expect(view.queryByText(forbidden)).toBeNull();
  }

  await fireEvent.press(
    view.getByLabelText('拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母，查看文章概述'),
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/editorial/[id]',
    params: { id: 'hero' },
  });

  await fireEvent.press(view.getByLabelText('查看The Economist'));
  await fireEvent.press(view.getByLabelText('查看2026-09-19'));
  expect(view.getByText('返回日期分类')).toBeTruthy();
  // 同一期内分页，末页文章仍可打开。
  for (let page = 0; page < 3; page += 1) {
    await fireEvent.press(view.getByLabelText('下一页'));
  }
  await fireEvent.press(view.getByLabelText('格洛丽亚·斯泰纳姆改变了美国女性的世界，查看文章概述'));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/editorial/[id]',
    params: { id: 'economist-2026-09-19-0c23ddbe-988f-4b85-adff-aa7431415ebf' },
  });
});

it('expands search and filters title, source, category, and no-result states', async () => {
  const view = await render(<EditorialHomeScreen />);
  await fireEvent.press(view.getByLabelText('搜索平台外刊'));
  const input = view.getByPlaceholderText('搜索中英文标题、来源或分类');

  await fireEvent.changeText(input, 'BBC Future');
  expect(view.getByText('拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母')).toBeTruthy();

  await fireEvent.changeText(input, '自然');
  expect(view.getByText('拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母')).toBeTruthy();

  await fireEvent.changeText(input, 'no such article');
  expect(view.getByText('没有找到相关外刊')).toBeTruthy();
});

it.each([
  ['ai-arms-race', '人工智能军备竞赛能被叫停吗？'],
  ['hero', '拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母'],
] as const)('opens %s through its overview', async (id, title) => {
  const view = await render(<EditorialHomeScreen />);
  if (id === 'ai-arms-race') {
    await fireEvent.press(view.getByLabelText('查看The Economist'));
    await fireEvent.press(view.getByLabelText('查看2026-09-19'));
  }
  await fireEvent.press(view.getByLabelText(`${title}，查看文章概述`));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/editorial/[id]',
    params: { id },
  });
});

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

it('browses publication then dates, and resets pagination when returning', async () => {
  const view = await render(<EditorialHomeScreen />);
  await fireEvent.press(view.getByLabelText('查看The Economist'));
  const expectedDates = [...new Set(getEditorialSection('featured')
    .filter((article) => article.source === 'The Economist')
    .map((article) => article.issueDate ?? article.publishedAt))].sort().reverse();
  const dateButtons = view.getAllByRole('button').filter((button) =>
    /^查看\d{4}-\d{2}-\d{2}$/.test(button.props.accessibilityLabel ?? ''));
  expect(dateButtons.map((button) => button.props.accessibilityLabel)).toEqual(expectedDates.map((date) => '查看' + date));
  await fireEvent.press(view.getByLabelText('查看2026-09-19'));
  await fireEvent.press(view.getByLabelText('下一页'));
  expect(view.getByText(/第 2 \/ \d+ 页/)).toBeTruthy();
  await fireEvent.press(view.getByLabelText('返回日期分类'));
  await fireEvent.press(view.getByLabelText('查看2026-09-19'));
  expect(view.getByText(/第 1 \/ \d+ 页/)).toBeTruthy();
  await fireEvent.press(view.getByLabelText('返回日期分类'));
  await fireEvent.press(view.getByLabelText('返回外刊分类'));
  await fireEvent.press(view.getByLabelText('查看WIRED'));
  expect(view.queryByLabelText('查看日期未标注')).toBeNull();
  expect(view.queryByLabelText('下一页')).toBeNull();
});

it('shows only 2026 original recordings', async () => {
  const view = await render(<EditorialHomeScreen />);
  await fireEvent.press(view.getByLabelText('只看原刊录音'));
  expect(view.getByLabelText('只看原刊录音').props.accessibilityState).toEqual({ selected: true });
  expect(view.getByLabelText('查看The Economist')).toBeTruthy();
  expect(view.queryByLabelText('查看The New Yorker')).toBeNull();

  await fireEvent.press(view.getByLabelText('查看The Economist'));
  expect(view.getByLabelText('查看2026-09-19')).toBeTruthy();
  // 2026 年远程录音只在配置了媒体地址时出现。
  if (process.env.EXPO_PUBLIC_EDITORIAL_AUDIO_ORIGIN) {
    expect(view.getByLabelText('查看2026-08-29')).toBeTruthy();
  } else {
    expect(view.queryByLabelText('查看2026-08-29')).toBeNull();
  }
  expect(view.queryByLabelText('查看2025-04-12')).toBeNull();
  expect(view.queryByLabelText('查看2025-04-19')).toBeNull();

  await fireEvent.press(view.getByLabelText('查看2026-09-19'));
  expect(view.getByLabelText('人工智能军备竞赛能被叫停吗？，查看文章概述')).toBeTruthy();
  expect(view.getAllByText('原刊录音').length).toBeGreaterThan(0);
});
