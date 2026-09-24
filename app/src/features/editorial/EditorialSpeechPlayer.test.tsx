import { act, fireEvent, render } from '@testing-library/react-native';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import React from 'react';

import { EditorialSpeechPlayer } from './EditorialSpeechPlayer';

jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn() }));
jest.mock('expo-speech', () => ({
  maxSpeechInputLength: 4000,
  speak: jest.fn(),
  stop: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void)) => {
    const React = jest.requireActual('react');
    // 测试中通过 rerender 模拟导航焦点变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
  },
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));

let mockFocused = true;

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  jest.mocked(setAudioModeAsync).mockResolvedValue();
  jest.mocked(Speech.stop).mockResolvedValue();
});

it('loads text only on play and reads long articles in native-safe chunks', async () => {
  const loadText = jest.fn(() => ['word '.repeat(500)]);
  const view = await render(<EditorialSpeechPlayer loadText={loadText} />);
  expect(view.getByText('AI配音 · 非原刊录音')).toBeTruthy();
  expect(loadText).not.toHaveBeenCalled();

  await fireEvent.press(view.getByLabelText('播放AI配音'));
  expect(loadText).toHaveBeenCalledTimes(1);
  expect(setAudioModeAsync).toHaveBeenCalledWith({ playsInSilentMode: true, shouldPlayInBackground: false });
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(jest.mocked(Speech.speak).mock.calls[0]![0].length).toBeLessThanOrEqual(1200);
  expect(jest.mocked(Speech.speak).mock.calls[0]![1]).toMatchObject({ language: 'en-US' });

  await act(async () => { jest.mocked(Speech.speak).mock.calls[0]![1]?.onDone?.(); });
  expect(Speech.speak).toHaveBeenCalledTimes(2);
  expect(view.getByText(/朗读片段 2 \/ 3/)).toBeTruthy();
  await act(async () => { jest.mocked(Speech.speak).mock.calls[1]![1]?.onDone?.(); });
  await act(async () => { jest.mocked(Speech.speak).mock.calls[2]![1]?.onDone?.(); });
  expect(view.getByLabelText('重新播放AI配音')).toBeTruthy();
});

it('stops on navigation blur and ignores completion from an earlier utterance', async () => {
  const view = await render(<EditorialSpeechPlayer loadText={() => ['First.', 'Second.']} />);
  await fireEvent.press(view.getByLabelText('播放AI配音'));
  const first = jest.mocked(Speech.speak).mock.calls[0]![1]?.onDone;
  mockFocused = false;
  await view.rerender(<EditorialSpeechPlayer loadText={() => ['First.', 'Second.']} />);
  expect(Speech.stop).toHaveBeenCalledTimes(2);
  await act(async () => { first?.(); });
  expect(Speech.speak).toHaveBeenCalledTimes(1);
});

it('offers a retry if audio setup fails', async () => {
  jest.mocked(setAudioModeAsync).mockRejectedValueOnce(new Error('audio unavailable'));
  const view = await render(<EditorialSpeechPlayer loadText={() => ['Article text.']} />);
  await fireEvent.press(view.getByLabelText('播放AI配音'));
  expect(view.getByText('朗读失败，请重试')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('播放AI配音'));
  expect(Speech.speak).toHaveBeenCalledTimes(1);
});
