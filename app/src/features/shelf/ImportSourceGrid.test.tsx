import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { ImportSourceGrid } from './ImportSourceGrid';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

it('shows all five import methods and preserves their destinations', async () => {
  const view = await render(<ImportSourceGrid />);
  const destinations = [
    ['网页链接', { pathname: '/import', params: { source: 'link' } }],
    ['粘贴正文', { pathname: '/import', params: { source: 'paste' } }],
    ['相册', { pathname: '/import', params: { source: 'album' } }],
    ['本地', { pathname: '/import', params: { source: 'local' } }],
    ['电脑', '/import-computer'],
  ] as const;
  for (const [label, destination] of destinations) {
    await fireEvent.press(view.getByLabelText(label));
    expect(router.push).toHaveBeenLastCalledWith(destination);
  }
});
