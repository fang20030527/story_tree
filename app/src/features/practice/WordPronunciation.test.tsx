import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Speech from 'expo-speech';

import { WordPronunciation } from './WordPronunciation';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-speech', () => ({
  speak: jest.fn(), stop: jest.fn(), getAvailableVoicesAsync: jest.fn(),
}));

const voices = [
  { identifier: 'british', language: 'en-GB', name: 'British', quality: 'Default' as Speech.VoiceQuality },
  { identifier: 'american', language: 'en-US', name: 'American', quality: 'Default' as Speech.VoiceQuality },
];

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(Speech.stop).mockResolvedValue();
  jest.mocked(Speech.getAvailableVoicesAsync).mockResolvedValue(voices);
});

it('plays the selected accent and stops speech when the card closes', async () => {
  const view = await render(<WordPronunciation term="resilient" phoneticUk="/rɪˈzɪliənt/" phoneticUs="/rɪˈzɪliənt/" />);
  await fireEvent.press(view.getByLabelText('播放英式发音'));
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith('resilient', expect.objectContaining({ language: 'en-GB', voice: 'british' })));
  await fireEvent.press(view.getByLabelText('播放美式发音'));
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith('resilient', expect.objectContaining({ language: 'en-US', voice: 'american' })));
  await view.unmount();
  expect(Speech.stop).toHaveBeenCalledTimes(3);
});

it('reports a missing accent instead of playing another language or accent', async () => {
  jest.mocked(Speech.getAvailableVoicesAsync).mockResolvedValue([voices[1]]);
  const view = await render(<WordPronunciation term="resilient" />);
  await fireEvent.press(view.getByLabelText('播放英式发音'));
  await waitFor(() => expect(view.getByText('设备暂无英式语音，请在系统语音设置中添加后重试')).toBeTruthy());
  expect(Speech.speak).not.toHaveBeenCalled();
});

it('does not play a stale request after the card closes', async () => {
  let resolveVoices!: (value: Speech.Voice[]) => void;
  jest.mocked(Speech.getAvailableVoicesAsync).mockReturnValue(new Promise((resolve) => { resolveVoices = resolve; }));
  const view = await render(<WordPronunciation term="resilient" />);
  await fireEvent.press(view.getByLabelText('播放英式发音'));
  await view.unmount();
  await act(async () => { resolveVoices(voices); });
  expect(Speech.speak).not.toHaveBeenCalled();
});
