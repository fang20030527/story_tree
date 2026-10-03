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
it('claims the gesture from parent scrollers, keeps it until release and reports drag state', async () => {
  const seek = jest.fn();
  const onDragChange = jest.fn();
  const view = await render(<ShadowingProgress time={0} duration={100} enabled seek={seek} onDragChange={onDragChange} />);
  const slider = view.getByLabelText('原音播放进度');
  // 捕获阶段认领、拒绝外层 ScrollView 的转让请求，并扩大细进度条的触控范围。
  expect(slider.props.onStartShouldSetResponderCapture()).toBe(true);
  expect(slider.props.onMoveShouldSetResponderCapture()).toBe(true);
  expect(slider.props.onResponderTerminationRequest()).toBe(false);
  expect(slider.props.hitSlop).toMatchObject({ top: 10, bottom: 10 });
  const touch = (locationX: number, pageX: number) => ({ nativeEvent: { locationX, pageX, touches: [], changedTouches: [] }, touchHistory: { touchBank: [] } });
  // 布局前的触摸不算拖动，也不通知页面。
  await fireEvent(slider, 'responderGrant', touch(10, 10));
  await fireEvent(slider, 'responderRelease', touch(10, 10));
  expect(onDragChange).not.toHaveBeenCalled();

  await fireEvent(slider, 'layout', { nativeEvent: { layout: { width: 200, height: 36, x: 0, y: 0 } } });
  await fireEvent(slider, 'responderGrant', touch(100, 100));
  expect(onDragChange).toHaveBeenLastCalledWith(true);
  await fireEvent(slider, 'responderMove', touch(100, 150));
  await fireEvent(slider, 'responderRelease', touch(100, 150));
  expect(onDragChange).toHaveBeenLastCalledWith(false);
  expect(seek).toHaveBeenCalledTimes(1);
  expect(seek).toHaveBeenLastCalledWith(75);

  // 被系统手势取消时同样恢复页面，但不定位。
  await fireEvent(slider, 'responderGrant', touch(20, 20));
  await fireEvent(slider, 'responderTerminate', touch(20, 20));
  expect(onDragChange).toHaveBeenCalledTimes(4);
  expect(onDragChange).toHaveBeenLastCalledWith(false);
  expect(seek).toHaveBeenCalledTimes(1);
});
it('does not claim touches while disabled', async () => {
  const view = await render(<ShadowingProgress time={0} duration={100} enabled={false} seek={jest.fn()} />);
  const slider = view.getByLabelText('原音播放进度');
  expect(slider.props.onStartShouldSetResponderCapture()).toBe(false);
  expect(slider.props.onStartShouldSetResponder()).toBe(false);
});
