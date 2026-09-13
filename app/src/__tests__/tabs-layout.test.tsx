import { render } from '@testing-library/react-native';
import React from 'react';

import TabLayout from '@/app/(tabs)/_layout';

type CapturedScreen = {
  name: string;
  options: { title: string };
};
const mockScreens: CapturedScreen[] = [];

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
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

it('declares exactly the four semantic navigation tabs', async () => {
  mockScreens.length = 0;
  await render(<TabLayout />);
  expect(mockScreens.map(({ name, options }) => ({
    name, title: options.title,
  }))).toEqual([
    { name: 'index', title: '外刊' },
    { name: 'shelf', title: '书架' },
    { name: 'words', title: '词库' },
    { name: 'profile', title: '我的' },
  ]);
  expect(mockScreens.some(({ name }) => name === 'feed')).toBe(false);
});
