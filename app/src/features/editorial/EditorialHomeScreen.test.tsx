import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, Animated, ScrollView } from 'react-native';

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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

it('keeps the daily feature unchanged when combining topic and publication filters', async () => {
  const view = await render(<EditorialHomeScreen />);
  const label = '拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母，查看文章概述';
  await fireEvent.press(view.getByLabelText('筛选科技'));
  await fireEvent.press(view.getByLabelText('筛选The Economist'));
  expect(view.getByText('每日精选')).toBeTruthy();
  await fireEvent.press(view.getByLabelText(label));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/editorial/[id]', params: { id: 'hero' } });
  expect(view.queryByLabelText('查看BBC Future')).toBeNull();
});

it('shows only the approved discovery sections and opens an overview', async () => {
  const view = await render(<EditorialHomeScreen />);
  expect(view.getByRole('header', { name: '外刊' })).toBeTruthy();
  for (const section of ['每日精选', '精选外刊']) {
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
    view.getAllByLabelText('拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母，查看文章概述')[0],
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
  expect(view.getAllByText('拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母')[0]).toBeTruthy();

  await fireEvent.changeText(input, '自然');
  expect(view.getAllByText('拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母')[0]).toBeTruthy();

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
  await fireEvent.press(view.getAllByLabelText(`${title}，查看文章概述`)[0]);
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
  expect(view.getAllByLabelText('人工智能军备竞赛能被叫停吗？，查看文章概述')[0]).toBeTruthy();
  expect(view.getAllByText('原刊录音').length).toBeGreaterThan(0);
});

it('keeps the daily card still when a touch becomes a scroll', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const sequence = jest.spyOn(Animated, 'sequence');
  const view = await render(<EditorialHomeScreen />);
  const label = '拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母，查看文章概述';
  const idleStyle = view.getByLabelText(label).props.style;
  const touch = { currentTarget: 1, persist: jest.fn(), nativeEvent: { pageX: 80, pageY: 240, timestamp: 0 } };

  await fireEvent(view.getByLabelText(label), 'responderGrant', touch);
  expect(view.getByLabelText(label).props.style).toEqual(idleStyle);
  await fireEvent(view.getByLabelText(label), 'responderTerminate', touch);
  expect(sequence).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

it('opens the daily article once after its tap animation finishes', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  let complete: ((result: { finished: boolean }) => void) | undefined;
  const sequence = jest.spyOn(Animated, 'sequence').mockReturnValue({
    start: (callback) => { complete = callback; }, stop: jest.fn(), reset: jest.fn(),
  });
  const view = await render(<EditorialHomeScreen />);
  const card = view.getByLabelText('拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母，查看文章概述');

  await fireEvent.press(card);
  await fireEvent.press(card);
  expect(sequence).toHaveBeenCalledTimes(1);
  expect(router.push).not.toHaveBeenCalled();
  await act(() => { complete?.({ finished: true }); });
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith({ pathname: '/editorial/[id]', params: { id: 'hero' } });
});

it.each([
  { columns: 64, discovery: 580, section: 3000 },
  { columns: 64, discovery: 0, section: 3000 },
])('keeps classification, pagination, and back navigation at the featured section with offsets %o', async (offsets) => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 0; });
  const view = await render(<EditorialHomeScreen />);
  const scroll = view.getByTestId('editorial-scroll');
  await fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: 700 } } });
  for (const [key, testID] of [
    ['columns', 'editorial-columns'], ['discovery', 'editorial-discovery'], ['section', 'editorial-featured-section'],
  ] as const) {
    await fireEvent(view.getByTestId(testID), 'layout', { nativeEvent: { layout: { y: offsets[key] } } });
  }
  expect(view.getByTestId('editorial-featured-section')).toHaveStyle({ minHeight: 700 });
  const y = offsets.columns + offsets.discovery + offsets.section;

  for (const label of [
    '查看The Economist', '查看2026-09-19', '下一页', '上一页',
    '返回日期分类', '返回外刊分类', '查看BBC Future', '返回外刊分类', '只看原刊录音',
  ]) {
    scrollTo.mockClear();
    await fireEvent.press(view.getByLabelText(label));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y, animated: false });
  }
});

it('opens BBC articles directly without an issue-date step', async () => {
  const view = await render(<EditorialHomeScreen />);
  await fireEvent.press(view.getByLabelText('查看BBC Future'));
  expect(view.getByText(/BBC Future · 共 \d+ 篇/)).toBeTruthy();
  expect(view.getByLabelText('返回外刊分类')).toBeTruthy();
  expect(view.getAllByRole('button').some((button) => /^查看\d{4}-\d{2}-\d{2}$/.test(button.props.accessibilityLabel ?? ''))).toBe(false);
  const article = getEditorialSection('featured').find((item) => item.source === 'BBC Future')!;
  await fireEvent.press(view.getAllByLabelText(`${article.titleZh}，查看文章概述`).at(-1)!);
  expect(router.push).toHaveBeenCalledWith({ pathname: '/editorial/[id]', params: { id: article.id } });
});
