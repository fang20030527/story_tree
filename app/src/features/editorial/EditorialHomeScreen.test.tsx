import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { EditorialHomeScreen } from './EditorialHomeScreen';

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
  expect(view.queryByText('Gloria Steinem changed the world for American women')).toBeNull();
  for (const forbidden of ['导入文章', '生词长文练习', '书籍', '活动', '学习讨论']) {
    expect(view.queryByText(forbidden)).toBeNull();
  }

  await fireEvent.press(
    view.getByLabelText('年度最治愈直播：看瑞典北部驼鹿迁徙，查看文章概述'),
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/editorial/[id]',
    params: { id: 'hero' },
  });

  await fireEvent.press(view.getAllByText('更多')[0]!);
  expect(view.getByText('返回全部栏目')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Gloria Steinem changed the world for American women，查看文章概述'));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/editorial/[id]',
    params: { id: 'economist-2026-09-19-0c23ddbe-988f-4b85-adff-aa7431415ebf' },
  });
});

it('expands search and filters title, source, category, and no-result states', async () => {
  const view = await render(<EditorialHomeScreen />);
  await fireEvent.press(view.getByLabelText('搜索平台外刊'));
  const input = view.getByPlaceholderText('搜索中英文标题、来源或分类');

  await fireEvent.changeText(input, 'The Atlantic');
  expect(view.getByText('夜班工作者如何守护自己的睡眠节律')).toBeTruthy();
  expect(view.queryByText('AI 正在如何改变语言学习的底层逻辑')).toBeNull();

  await fireEvent.changeText(input, '动物');
  expect(view.getByText('一只金毛犬的治疗师生涯')).toBeTruthy();

  await fireEvent.changeText(input, 'no such article');
  expect(view.getByText('没有找到相关外刊')).toBeTruthy();
});

it.each([
  ['hero', '年度最治愈直播：看瑞典北部驼鹿迁徙'],
  ['a1', 'AI 正在如何改变语言学习的底层逻辑'],
  ['n1', '加拿大就业市场在八月出现回落'],
  ['k1', '蘑菇其实是森林的“快递网络”'],
] as const)('opens %s through its overview', async (id, title) => {
  const view = await render(<EditorialHomeScreen />);
  await fireEvent.press(view.getByLabelText(`${title}，查看文章概述`));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/editorial/[id]',
    params: { id },
  });
});
