import { act, fireEvent, render } from '@testing-library/react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React from 'react';

import { EditorialAudioPlayer } from './EditorialAudioPlayer';

jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(), useAudioPlayerStatus: jest.fn(), setAudioModeAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void)) => {
    const React = jest.requireActual('react');
    React.useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
  },
}));
jest.mock('@expo/ui', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Picker = Object.assign(
    ({
      selectedValue,
      enabled,
      onValueChange,
      testID,
    }: {
      selectedValue: number;
      enabled: boolean;
      onValueChange: (value: number) => void;
      testID: string;
    }) => {
      const viewProps = {
        testID,
        accessibilityRole: 'button' as const,
        accessibilityLabel: `${selectedValue} 倍速`,
        accessibilityState: { disabled: !enabled },
        onValueChange: enabled ? onValueChange : undefined,
      };
      return React.createElement(View, viewProps);
    },
    { Item: () => null },
  );
  const Host = ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children);
  return { Host, Picker };
});
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

const player = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), replace: jest.fn(), setPlaybackRate: jest.fn(), shouldCorrectPitch: false };
let released = false;
let mockFocused = true;
let status: { isLoaded: boolean; playing: boolean; didJustFinish: boolean; currentTime: number; duration: number; error: string | null };

beforeEach(() => {
  jest.clearAllMocks();
  released = false;
  mockFocused = true;
  player.shouldCorrectPitch = false;
  player.pause.mockImplementation(() => {
    if (released) throw new Error('Cannot use a released native audio player');
  });
  status = { isLoaded: true, playing: false, didJustFinish: false, currentTime: 0, duration: 300, error: null };
  jest.mocked(useAudioPlayer).mockImplementation(() => {
    // 模拟 Expo 在 useFocusEffect 清理之前释放原生播放器。
    React.useEffect(() => () => { released = true; }, []);
    return player as unknown as ReturnType<typeof useAudioPlayer>;
  });
  jest.mocked(useAudioPlayerStatus).mockImplementation(() => status as ReturnType<typeof useAudioPlayerStatus>);
  jest.mocked(setAudioModeAsync).mockResolvedValue();
  player.seekTo.mockResolvedValue(undefined);
});

it('plays, pauses, shows elapsed time, and pauses when losing focus', async () => {
  const view = await render(<EditorialAudioPlayer source={7} />);
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(setAudioModeAsync).toHaveBeenCalledWith({ playsInSilentMode: true, shouldPlayInBackground: false });
  status = { ...status, playing: true, currentTime: 62 };
  await view.rerender(<EditorialAudioPlayer source={7} />);
  expect(view.getByText('1:02 / 5:00')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('暂停音频'));
  expect(player.pause).toHaveBeenCalledTimes(1);
  mockFocused = false;
  await view.rerender(<EditorialAudioPlayer source={7} />);
  expect(player.pause).toHaveBeenCalledTimes(2);
  await view.unmount();
});

it('rewinds completed audio before replaying', async () => {
  status = { ...status, didJustFinish: true, currentTime: 300 };
  const view = await render(<EditorialAudioPlayer source={7} />);
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(player.seekTo).toHaveBeenCalledWith(0);
  expect(player.play).toHaveBeenCalledTimes(1);
});

it('reports playback failures and permits retry', async () => {
  jest.mocked(setAudioModeAsync).mockRejectedValueOnce(new Error('unavailable'));
  const view = await render(<EditorialAudioPlayer source={7} />);
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(view.getByText('音频播放失败，请重试')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('重试音频'));
  expect(player.play).toHaveBeenCalledTimes(1);
});

it('reloads an asset after a load failure', async () => {
  status = { ...status, isLoaded: false, error: 'load failed' };
  const view = await render(<EditorialAudioPlayer source={7} />);
  await fireEvent.press(view.getByLabelText('重试音频'));
  expect(player.replace).toHaveBeenCalledWith(7);
});

it('lets a stalled remote recording be retried and downloads it before playback', async () => {
  jest.useFakeTimers();
  try {
    status = { ...status, isLoaded: false, duration: 0 };
    const url = 'https://reader.example.test/v1/editorial/audio/example';
    const view = await render(<EditorialAudioPlayer source={url} />);
    expect(useAudioPlayer).toHaveBeenCalledWith(url, { updateInterval: 100, downloadFirst: true });
    expect(view.getByLabelText('音频加载中')).toBeDisabled();
    await act(async () => { jest.advanceTimersByTime(15_000); });
    expect(view.getByText('音频加载超时，请重试')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('重试音频'));
    expect(player.replace).toHaveBeenCalledWith(url);
    expect(view.getByLabelText('音频加载中')).toBeDisabled();
    status = { ...status, isLoaded: true, duration: 120 };
    await view.rerender(<EditorialAudioPlayer source={url} />);
    await fireEvent.press(view.getByLabelText('播放音频'));
    expect(player.play).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('does not start playback if the page was left during audio setup', async () => {
  let finish!: () => void;
  jest.mocked(setAudioModeAsync).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const view = await render(<EditorialAudioPlayer source={7} />);
  await fireEvent.press(view.getByLabelText('播放音频'));
  await view.unmount();
  await act(async () => finish());
  expect(player.play).not.toHaveBeenCalled();
});

it('does not call the released native player when the reader unmounts', async () => {
  const view = await render(<EditorialAudioPlayer source={7} />);
  await view.unmount();
  expect(released).toBe(true);
  expect(player.pause).not.toHaveBeenCalled();
});

it('previews a drag and seeks once on release without changing playback state', async () => {
  const view = await render(<EditorialAudioPlayer source={7} />);
  const slider = view.getByLabelText('音频进度');
  await fireEvent(slider, 'layout', { nativeEvent: { layout: { width: 200 } } });
  await fireEvent(slider, 'responderGrant', { nativeEvent: { pageX: 120, locationX: 100 } });
  expect(view.getByText('2:30 / 5:00')).toBeTruthy();
  await fireEvent(slider, 'responderMove', { nativeEvent: { pageX: 170 } });
  expect(view.getByText('3:45 / 5:00')).toBeTruthy();
  expect(player.seekTo).not.toHaveBeenCalled();
  await fireEvent(slider, 'responderRelease');
  expect(player.seekTo).toHaveBeenCalledWith(225);
  expect(player.play).not.toHaveBeenCalled();
});

it('clamps accessible seeks and reports seek failure', async () => {
  status = { ...status, currentTime: 296 };
  const view = await render(<EditorialAudioPlayer source={7} />);
  await fireEvent(view.getByLabelText('音频进度'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(player.seekTo).toHaveBeenCalledWith(300);
  player.seekTo.mockRejectedValueOnce(new Error('seek failed'));
  await fireEvent(view.getByLabelText('音频进度'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  expect(view.getByText('音频播放失败，请重试')).toBeTruthy();
});

it('publishes actual playback positions including paused seeks', async () => {
  const onPositionChange = jest.fn();
  const view = await render(<EditorialAudioPlayer source={7} onPositionChange={onPositionChange} />);
  status = { ...status, currentTime: 80 };
  await view.rerender(<EditorialAudioPlayer source={7} onPositionChange={onPositionChange} />);
  expect(onPositionChange).toHaveBeenLastCalledWith({ currentTime: 80, duration: 300, playing: false });
});

it('changes speed during playback without restarting or seeking', async () => {
  status = { ...status, playing: true, currentTime: 62 };
  const view = await render(<EditorialAudioPlayer source={7} />);
  expect(view.getByLabelText('1 倍速')).toBeTruthy();
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 1.5);
  expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.5, 'high');
  expect(player.shouldCorrectPitch).toBe(true);
  expect(view.getByLabelText('1.5 倍速')).toBeTruthy();
  expect(view.getByText('1:02 / 5:00')).toBeTruthy();
  expect(player.play).not.toHaveBeenCalled();
  expect(player.pause).not.toHaveBeenCalled();
  expect(player.seekTo).not.toHaveBeenCalled();
});

it('keeps the chosen speed when starting paused audio and replaying', async () => {
  const view = await render(<EditorialAudioPlayer source={7} />);
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 0.75);
  expect(player.play).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(player.setPlaybackRate).toHaveBeenLastCalledWith(0.75, 'high');
  status = { ...status, currentTime: 300, didJustFinish: true };
  await view.rerender(<EditorialAudioPlayer source={7} />);
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(player.seekTo).toHaveBeenCalledWith(0);
  expect(player.setPlaybackRate).toHaveBeenLastCalledWith(0.75, 'high');
  expect(player.play).toHaveBeenCalledTimes(2);
});

it('disables speed controls while loading or when the audio has failed', async () => {
  status = { ...status, isLoaded: false };
  const view = await render(<EditorialAudioPlayer source={7} />);
  expect(view.getByLabelText('1 倍速')).toBeDisabled();
  status = { ...status, isLoaded: true, error: 'load failed' };
  await view.rerender(<EditorialAudioPlayer source={7} />);
  expect(view.getByLabelText('1 倍速')).toBeDisabled();
  expect(player.setPlaybackRate).not.toHaveBeenCalled();
});

it('retains the previous selection when changing speed fails and allows retry', async () => {
  const view = await render(<EditorialAudioPlayer source={7} />);
  player.setPlaybackRate.mockImplementationOnce(() => { throw new Error('unavailable'); });
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 2);
  expect(view.getByLabelText('1 倍速')).toBeTruthy();
  expect(view.getByText('倍速调整失败，请重试')).toBeTruthy();
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 2);
  expect(view.getByLabelText('2 倍速')).toBeTruthy();
  expect(view.queryByText('倍速调整失败，请重试')).toBeNull();
});
