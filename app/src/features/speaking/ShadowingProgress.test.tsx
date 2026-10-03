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
it('ignores drags before layout and seeks once with the released position', async () => {
  const seek = jest.fn();
  const view = await render(<ShadowingProgress time={0} duration={100} enabled seek={seek} />);
  const slider = view.getByLabelText('原音播放进度');
  const touch = (locationX: number, pageX: number) => ({ nativeEvent: { locationX, pageX, touches: [], changedTouches: [] }, touchHistory: { touchBank: [] } });
  // 宽度为 0 时无法换算位置：不进入拖动，也不产生 NaN 定位。
  await fireEvent(slider, 'responderGrant', touch(10, 10));
  await fireEvent(slider, 'responderRelease', touch(10, 10));
  expect(seek).not.toHaveBeenCalled();

  await fireEvent(slider, 'layout', { nativeEvent: { layout: { width: 200, height: 30, x: 0, y: 0 } } });
  await fireEvent(slider, 'responderGrant', touch(50, 50));
  await fireEvent(slider, 'responderMove', touch(50, 150));
  await fireEvent(slider, 'responderMove', touch(50, 400));
  expect(seek).not.toHaveBeenCalled();
  await fireEvent(slider, 'responderRelease', touch(50, 400));
  expect(seek).toHaveBeenCalledTimes(1);
  expect(seek).toHaveBeenLastCalledWith(100);
});
