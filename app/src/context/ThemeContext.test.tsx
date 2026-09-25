import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';

import { AppThemeProvider, useAppTheme } from './ThemeContext';

const STORAGE_KEY = '@waikan/theme-mode';

function ThemeProbe() {
  const { mode, setPreference } = useAppTheme();
  return (
    <>
      <Text testID="theme-mode">{mode}</Text>
      <TouchableOpacity onPress={() => setPreference('dark')}>
        <Text>选择深色</Text>
      </TouchableOpacity>
    </>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('将旧版跟随系统设置改为浅色，并允许手动切换到深色', async () => {
  await AsyncStorage.setItem(STORAGE_KEY, 'system');
  const view = await render(<AppThemeProvider><ThemeProbe /></AppThemeProvider>);

  expect(view.getByTestId('theme-mode').props.children).toBe('light');
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  await fireEvent.press(view.getByText('选择深色'));
  expect(view.getByTestId('theme-mode').props.children).toBe('dark');
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('dark');
  });
});

it('保留用户之前明确选择的深色模式', async () => {
  await AsyncStorage.setItem(STORAGE_KEY, 'dark');
  const view = await render(<AppThemeProvider><ThemeProbe /></AppThemeProvider>);

  await waitFor(() => {
    expect(view.getByTestId('theme-mode').props.children).toBe('dark');
  });
});
