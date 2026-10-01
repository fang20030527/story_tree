import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router } from 'expo-router';
import React from 'react';

import { EditorialAudioPlayer } from './EditorialAudioPlayer';
import { EditorialAudioProvider, type EditorialAudioTrack } from './EditorialAudioProvider';
import { FloatingEditorialAudioPlayer } from './FloatingEditorialAudioPlayer';

jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(), useAudioPlayerStatus: jest.fn(), setAudioModeAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));
jest.mock('@/components/useLayoutWidth', () => ({ useLayoutWidth: () => 390 }));
jest.mock('@expo/ui', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Picker = Object.assign(
    ({ selectedValue, enabled, onValueChange, testID }: {
      selectedValue: number;
      enabled: boolean;
      onValueChange: (value: number) => void;
      testID: string;
    }) => {
      const props = {
        testID,
        accessibilityRole: 'button' as const,
        accessibilityLabel: `${selectedValue} 倍速`,
        accessibilityState: { disabled: !enabled },
        onValueChange: enabled ? onValueChange : undefined,
      };
      return React.createElement(View, props);
    },
    { Item: () => null },
  );
  const Host = ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children);
  return { Host, Picker };
});
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

const articleA: EditorialAudioTrack = { articleId: 'article-a', title: '文章 A', source: 7 };
const articleB: EditorialAudioTrack = { articleId: 'article-b', title: '文章 B', source: 8 };
const makePlayer = () => {
  const player = {
    play: jest.fn(), pause: jest.fn(), seekTo: jest.fn().mockResolvedValue(undefined),
    setPlaybackRate: jest.fn(), shouldCorrectPitch: false, released: false,
  };
  player.pause.mockImplementation(() => {
    if (player.released) throw new Error('Cannot use a released native audio player');
  });
  return player;
};
let players: ReturnType<typeof makePlayer>[];
let status: { isLoaded: boolean; playing: boolean; didJustFinish: boolean; currentTime: number; duration: number; error: string | null };

function Harness({ track = articleA, page = 'overview', onPositionChange }: {
  track?: EditorialAudioTrack;
  page?: 'overview' | 'read' | 'other';
  onPositionChange?: React.ComponentProps<typeof EditorialAudioPlayer>['onPositionChange'];
}) {
  return (
    <EditorialAudioProvider>
      {page !== 'other' ? <EditorialAudioPlayer key={`${page}:${track.articleId}`} {...track} onPositionChange={onPositionChange} /> : null}
      <FloatingEditorialAudioPlayer />
    </EditorialAudioProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  players = [];
  status = { isLoaded: true, playing: false, didJustFinish: false, currentTime: 0, duration: 300, error: null };
  jest.mocked(useAudioPlayer).mockImplementation(() => {
    const player = React.useMemo(() => {
      const next = makePlayer();
      players.push(next);
      return next;
    }, []);
    // 模拟 Expo 被动清理释放原生对象，检测卸载后误调用。
    React.useEffect(() => () => { player.released = true; }, [player]);
    return player as unknown as ReturnType<typeof useAudioPlayer>;
  });
  jest.mocked(useAudioPlayerStatus).mockImplementation(() => status as ReturnType<typeof useAudioPlayerStatus>);
  jest.mocked(setAudioModeAsync).mockResolvedValue();
});

async function start(props: React.ComponentProps<typeof Harness> = {}) {
  const view = await render(<Harness {...props} />);
  await fireEvent.press(view.getByLabelText('播放音频'));
  return view;
}

it('只有点击播放才加载录音并显示悬浮播放器', async () => {
  const view = await render(<Harness />);
  expect(players).toHaveLength(0);
  expect(view.queryByTestId('floating-editorial-audio')).toBeNull();
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(players[0]!.play).toHaveBeenCalledTimes(1);
  expect(setAudioModeAsync).toHaveBeenCalledWith({ playsInSilentMode: true, shouldPlayInBackground: false });
  expect(view.getByTestId('floating-editorial-audio')).toHaveStyle({ bottom: 108 });
});

it('概述进入正文、离开页面和重新打开时共用播放进度与倍速', async () => {
  const view = await start();
  const player = players[0]!;
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 1.5);
  status = { ...status, playing: true, currentTime: 62 };
  await view.rerender(<Harness page="read" />);
  expect(view.getByText('1:02 / 5:00')).toBeTruthy();
  expect(view.getByLabelText('1.5 倍速')).toBeTruthy();
  expect(view.getByLabelText('暂停音频')).toBeTruthy();
  expect(players).toHaveLength(1);
  expect(player.pause).not.toHaveBeenCalled();
  expect(player.seekTo).not.toHaveBeenCalled();
  await view.rerender(<Harness page="other" />);
  expect(view.getByText('正在播放 · 1:02')).toBeTruthy();
  expect(player.released).toBe(false);
  expect(player.pause).not.toHaveBeenCalled();
  await view.rerender(<Harness page="overview" />);
  expect(view.getByText('1:02 / 5:00')).toBeTruthy();
  expect(view.getByLabelText('1.5 倍速')).toBeTruthy();
  expect(player.play).toHaveBeenCalledTimes(1);
});

it('浏览另一篇文章不影响当前音频，点击新音频后才切换', async () => {
  const view = await start();
  const original = players[0]!;
  status = { ...status, playing: true, currentTime: 62 };
  const onPositionChange = jest.fn();
  await view.rerender(<Harness track={articleB} onPositionChange={onPositionChange} />);
  expect(view.getByText('文章 A')).toBeTruthy();
  expect(view.getByText('0:00 / 0:00')).toBeTruthy();
  expect(onPositionChange).toHaveBeenLastCalledWith({ currentTime: 0, duration: 0, playing: false });
  expect(original.pause).not.toHaveBeenCalled();
  expect(players).toHaveLength(1);
  status = { ...status, playing: false, currentTime: 0 };
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(original.pause).toHaveBeenCalledTimes(1);
  expect(original.released).toBe(true);
  expect(players).toHaveLength(2);
  expect(players[1]!.play).toHaveBeenCalledTimes(1);
  expect(view.getByText('文章 B')).toBeTruthy();
  expect(view.queryByText('文章 A')).toBeNull();
});

it('收起到右侧后切换页面仍保持播放，再次展开保留进度、倍速和控制', async () => {
  const view = await start();
  const player = players[0]!;
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 1.5);
  status = { ...status, playing: true, currentTime: 62 };
  await view.rerender(<Harness />);
  await fireEvent.press(view.getByLabelText('收起播放器'));
  expect(view.getByTestId('floating-editorial-audio')).toHaveStyle({ right: 0, width: 48 });
  expect(view.getByLabelText('展开播放器').props.accessibilityState).toEqual({ expanded: false });
  expect(view.queryByLabelText('暂停悬浮音频')).toBeNull();
  status = { ...status, currentTime: 80 };
  await view.rerender(<Harness page="other" />);
  expect(view.getByLabelText('展开播放器')).toBeTruthy();
  expect(player.released).toBe(false);
  expect(player.pause).not.toHaveBeenCalled();
  expect(player.seekTo).not.toHaveBeenCalled();
  expect(router.navigate).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('展开播放器'));
  expect(view.getByTestId('floating-editorial-audio')).toHaveStyle({ right: 16, width: 336 });
  expect(view.getByText('正在播放 · 1:20')).toBeTruthy();
  await view.rerender(<Harness page="read" />);
  expect(view.getByLabelText('1.5 倍速')).toBeTruthy();
  expect(players).toHaveLength(1);
  expect(player.play).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByLabelText('返回文章：文章 A'));
  expect(router.navigate).toHaveBeenCalledWith({ pathname: '/editorial/[id]/read', params: { id: 'article-a' } });
  await fireEvent.press(view.getByLabelText('关闭文章音频'));
  expect(view.queryByTestId('floating-editorial-audio')).toBeNull();
  expect(player.released).toBe(true);
});

it('收起后播放另一篇文章会展开新音频的播放器', async () => {
  const view = await start();
  await fireEvent.press(view.getByLabelText('收起播放器'));
  await view.rerender(<Harness track={articleB} />);
  expect(view.getByLabelText('展开播放器')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(view.getByLabelText('收起播放器')).toBeTruthy();
  expect(view.getByText('文章 B')).toBeTruthy();
});

it('悬浮播放器能返回当前文章、暂停、继续和关闭', async () => {
  const view = await start();
  status = { ...status, playing: true, currentTime: 62 };
  await view.rerender(<Harness page="other" />);
  await fireEvent.press(view.getByLabelText('返回文章：文章 A'));
  expect(router.navigate).toHaveBeenCalledWith({ pathname: '/editorial/[id]/read', params: { id: 'article-a' } });
  expect(players[0]!.pause).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('暂停悬浮音频'));
  expect(players[0]!.pause).toHaveBeenCalledTimes(1);
  status = { ...status, playing: false };
  await view.rerender(<Harness page="other" />);
  expect(view.getByText('已暂停 · 1:02')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('播放悬浮音频'));
  expect(players[0]!.play).toHaveBeenCalledTimes(2);
  await fireEvent.press(view.getByLabelText('关闭文章音频'));
  expect(view.queryByTestId('floating-editorial-audio')).toBeNull();
  expect(players[0]!.pause).toHaveBeenCalledTimes(2);
  expect(players[0]!.released).toBe(true);
  await view.rerender(<Harness page="read" />);
  expect(view.getByText('0:00 / 0:00')).toBeTruthy();
  expect(view.getByLabelText('播放音频')).toBeTruthy();
});

it('页面切换不会取消正在准备的播放', async () => {
  let finish!: () => void;
  jest.mocked(setAudioModeAsync).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const view = await start();
  await view.rerender(<Harness page="other" />);
  await act(async () => finish());
  expect(players[0]!.play).toHaveBeenCalledTimes(1);
});

it('准备播放时关闭音频会阻止延迟启动', async () => {
  let finish!: () => void;
  jest.mocked(setAudioModeAsync).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const view = await start();
  await fireEvent.press(view.getByLabelText('关闭文章音频'));
  await act(async () => finish());
  expect(players[0]!.play).not.toHaveBeenCalled();
  expect(players[0]!.released).toBe(true);
});

it('准备播放时切换文章只会启动新音频', async () => {
  let finish!: () => void;
  jest.mocked(setAudioModeAsync).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const view = await start();
  await view.rerender(<Harness track={articleB} />);
  await fireEvent.press(view.getByLabelText('播放音频'));
  await act(async () => finish());
  expect(players[0]!.play).not.toHaveBeenCalled();
  expect(players[1]!.play).toHaveBeenCalledTimes(1);
});

it('卸载应用后不调用已释放的原生播放器', async () => {
  let finish!: () => void;
  jest.mocked(setAudioModeAsync).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const view = await start();
  const player = players[0]!;
  await view.unmount();
  await act(async () => finish());
  expect(player.released).toBe(true);
  expect(player.pause).not.toHaveBeenCalled();
  expect(player.play).not.toHaveBeenCalled();
});

it('播放结束后保留悬浮播放器，重播会回到开头并保留倍速', async () => {
  const view = await start();
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 0.75);
  status = { ...status, didJustFinish: true, currentTime: 300 };
  await view.rerender(<Harness />);
  expect(view.getByText('播放结束 · 5:00')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('播放音频'));
  expect(players[0]!.seekTo).toHaveBeenCalledWith(0);
  expect(players[0]!.setPlaybackRate).toHaveBeenLastCalledWith(0.75, 'high');
  expect(players[0]!.play).toHaveBeenCalledTimes(2);
});

it('播放失败可重试', async () => {
  jest.mocked(setAudioModeAsync).mockRejectedValueOnce(new Error('unavailable'));
  const view = await start();
  expect(view.getByText('音频播放失败，请重试')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('重试音频'));
  expect(players[0]!.play).toHaveBeenCalledTimes(1);
  expect(view.queryByText('音频播放失败，请重试')).toBeNull();
});

it('加载失败后创建新会话重试，加载完成自动播放', async () => {
  status = { ...status, isLoaded: false, error: 'load failed' };
  const view = await start();
  await fireEvent.press(view.getByLabelText('重试音频'));
  expect(players[0]!.released).toBe(true);
  status = { ...status, isLoaded: true, error: null };
  await view.rerender(<Harness />);
  await waitFor(() => expect(players[1]!.play).toHaveBeenCalledTimes(1));
});

it('远程录音先下载，超时后可从悬浮播放器重试', async () => {
  jest.useFakeTimers();
  try {
    status = { ...status, isLoaded: false, duration: 0 };
    const track = { ...articleA, source: 'https://reader.example.test/v1/editorial/audio/example' };
    const view = await start({ track });
    expect(useAudioPlayer).toHaveBeenCalledWith(track.source, { updateInterval: 100, downloadFirst: true });
    expect(view.getByLabelText('音频加载中')).toBeDisabled();
    await act(async () => { jest.advanceTimersByTime(15_000); });
    expect(view.getByText('音频加载超时，请重试')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('重试悬浮音频'));
    expect(players[0]!.released).toBe(true);
    expect(view.getByLabelText('音频加载中')).toBeDisabled();
    status = { ...status, isLoaded: true, duration: 120 };
    await view.rerender(<Harness track={track} />);
    expect(players[1]!.play).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('拖动时预览，松开后只定位一次且不改变播放状态', async () => {
  const view = await start();
  const player = players[0]!;
  player.play.mockClear();
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

it('辅助功能定位不会超出时长，定位失败显示错误', async () => {
  const view = await start();
  status = { ...status, currentTime: 296 };
  await view.rerender(<Harness />);
  await fireEvent(view.getByLabelText('音频进度'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(players[0]!.seekTo).toHaveBeenCalledWith(300);
  players[0]!.seekTo.mockRejectedValueOnce(new Error('seek failed'));
  await fireEvent(view.getByLabelText('音频进度'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  expect(view.getByText('音频播放失败，请重试')).toBeTruthy();
});

it('暂停时定位也向正文发布最新进度', async () => {
  const onPositionChange = jest.fn();
  const view = await start({ onPositionChange });
  status = { ...status, currentTime: 80 };
  await view.rerender(<Harness onPositionChange={onPositionChange} />);
  expect(onPositionChange).toHaveBeenLastCalledWith({ currentTime: 80, duration: 300, playing: false });
});

it('改变倍速不重播或定位，失败保留原选择并允许重试', async () => {
  const view = await start();
  const player = players[0]!;
  player.play.mockClear();
  status = { ...status, playing: true, currentTime: 62 };
  await view.rerender(<Harness />);
  player.setPlaybackRate.mockImplementationOnce(() => { throw new Error('unavailable'); });
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 2);
  expect(view.getByLabelText('1 倍速')).toBeTruthy();
  expect(view.getByText('倍速调整失败，请重试')).toBeTruthy();
  await fireEvent(view.getByTestId('editorial-audio-rate-picker'), 'valueChange', 2);
  expect(player.setPlaybackRate).toHaveBeenLastCalledWith(2, 'high');
  expect(player.shouldCorrectPitch).toBe(true);
  expect(view.getByLabelText('2 倍速')).toBeTruthy();
  expect(view.queryByText('倍速调整失败，请重试')).toBeNull();
  expect(view.getByText('1:02 / 5:00')).toBeTruthy();
  expect(player.play).not.toHaveBeenCalled();
  expect(player.pause).not.toHaveBeenCalled();
  expect(player.seekTo).not.toHaveBeenCalled();
});

it('加载中或加载失败时禁用定位和倍速', async () => {
  status = { ...status, isLoaded: false };
  const view = await start();
  expect(view.getByLabelText('1 倍速')).toBeDisabled();
  expect(view.getByLabelText('音频进度')).toBeDisabled();
  status = { ...status, isLoaded: true, error: 'load failed' };
  await view.rerender(<Harness />);
  expect(view.getByLabelText('1 倍速')).toBeDisabled();
  expect(view.getByLabelText('音频进度')).toBeDisabled();
  expect(players[0]!.setPlaybackRate).not.toHaveBeenCalled();
});
