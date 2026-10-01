import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import { ShadowingProgress } from './ShadowingProgress';
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
beforeEach(() => jest.replaceProperty(Platform, 'OS', 'web'));
afterEach(() => jest.restoreAllMocks());

it('clamps keyboard seeking and exposes the actual playback value', async () => {
  const seek = jest.fn();
  const view = await render(<ShadowingProgress time={8} duration={10} enabled seek={seek} />);
  const slider = view.getByLabelText('原音播放进度');
  expect(slider.props['aria-valuenow']).toBe(8);
  await fireEvent(slider, 'keyDown', { nativeEvent: { key: 'ArrowRight' }, preventDefault: jest.fn() });
  expect(seek).toHaveBeenLastCalledWith(10);
  await fireEvent(slider, 'keyDown', { nativeEvent: { key: 'Home' }, preventDefault: jest.fn() });
  expect(seek).toHaveBeenLastCalledWith(0);
});
it('does not seek while disabled or change the time on a canceled drag', async () => {
  const seek = jest.fn();
  const view = await render(<ShadowingProgress time={4} duration={10} enabled={false} seek={seek} />);
  await fireEvent(view.getByLabelText('原音播放进度'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(seek).not.toHaveBeenCalled();
});
