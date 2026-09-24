import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Keyboard, Platform, TextInput, type KeyboardEvent } from 'react-native';

import LoginScreen from '@/app/login';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));
jest.mock('@/api/email', () => ({
  loginWithEmail: jest.fn(),
  requestPasswordReset: jest.fn(),
  confirmPasswordReset: jest.fn(),
}));
jest.mock('@/api/practices', () => ({ registerAnonymous: jest.fn() }));
jest.mock('@/features/auth/authStorage', () => ({
  clearAuthUser: jest.fn(),
  saveAuthUserEmail: jest.fn(),
}));

afterEach(() => jest.restoreAllMocks());

it('moves from email to password and compacts the form when the keyboard opens', async () => {
  const keyboardListeners = new Map<string, () => void>();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
    keyboardListeners.set(event, () => listener({} as KeyboardEvent));
    return { remove: jest.fn() } as unknown as ReturnType<typeof Keyboard.addListener>;
  });
  const focus = jest.spyOn(TextInput.prototype, 'focus');
  const view = await render(<LoginScreen />);
  const emailInput = view.getByPlaceholderText('邮箱地址');
  const hero = view.getByText('同步你的学习进度').parent;

  expect(emailInput.props.returnKeyType).toBe('next');
  await fireEvent(emailInput, 'submitEditing');
  expect(focus).toHaveBeenCalledTimes(1);
  expect((focus.mock.contexts[0] as TextInput).props.placeholder).toBe('密码（至少 8 个字符）');

  await act(() => keyboardListeners.get(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow')?.());
  expect(hero).toHaveStyle({ display: 'none' });
  expect(view.getByPlaceholderText('密码（至少 8 个字符）')).toBeOnTheScreen();

  await act(() => keyboardListeners.get(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide')?.());
  expect(hero).not.toHaveStyle({ display: 'none' });
  await view.unmount();
});
