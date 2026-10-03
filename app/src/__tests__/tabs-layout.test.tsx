import { render } from '@testing-library/react-native';
import React from 'react';

import TabLayout from '@/app/(tabs)/_layout';

type CapturedScreen = {
  name: string;
  options: { title: string; href?: string | null };
};
const mockScreens: CapturedScreen[] = [];
const mockMode = { mode: 'read', setMode: jest.fn() };
jest.mock('@/context/LearningModeContext', () => ({ useLearningMode: () => mockMode }));
beforeEach(() => { mockScreens.length = 0; mockMode.mode = 'read'; });
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

jest.mock('expo-router', () => {
  const MockTabs = Object.assign(
    ({ children }: { children: React.ReactNode }) => children,
    { Screen: (props: CapturedScreen) => {
      mockScreens.push(props);
      return null;
    } },
  );
  return { Tabs: MockTabs };
});

it('switches to speaking materials, files and profile while hiding vocabulary', async () => {
  mockMode.mode = 'speak';
  await render(<TabLayout />);
  expect(mockScreens.filter(screen => screen.options.href !== null).map(screen => screen.options.title)).toEqual(['素材', '文件', '留言瓶', '我的']);
  expect(mockScreens.find(screen => screen.name === 'words')?.options.href).toBeNull();
});
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

it('declares reading tabs with a shared message bottle before profile', async () => {
  mockScreens.length = 0;
  await render(<TabLayout />);
  expect(mockScreens.map(({ name, options }) => ({
    name, title: options.title,
  }))).toEqual([
    { name: 'index', title: '外刊' },
    { name: 'shelf', title: '书架' },
    { name: 'words', title: '词库' },
    { name: 'message-bottles', title: '留言瓶' },
    { name: 'profile', title: '我的' },
  ]);
  expect(mockScreens.some(({ name }) => name === 'feed')).toBe(false);
});
