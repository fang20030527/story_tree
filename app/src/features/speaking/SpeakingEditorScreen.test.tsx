import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { router } from 'expo-router';
import { emptySpeakingStore, type SpeakingMaterial } from './model';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { saveSpeakingMaterialSubtitles } from './cloudSync';
import { SpeakingEditorScreen } from './SpeakingEditorScreen';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useLocalSearchParams: () => ({ id: 'film' }) }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('./useSpeakingLibrary', () => ({ useSpeakingLibrary: jest.fn() }));
jest.mock('./cloudSync', () => ({ saveSpeakingMaterialSubtitles: jest.fn() }));
jest.mock('./SpeakingComponents', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SpeakingHeader: ({ title }: { title: string }) => React.createElement(Text, null, title),
    SpeakingStatus: () => null,
    SpeakingButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) => React.createElement(Pressable, { onPress, disabled }, React.createElement(Text, null, label)),
    speakingStyles: {},
  };
});
const material: SpeakingMaterial = {
  id: 'film', title: 'Long movie', subtitle: '', category: '', origin: 'file', mediaType: 'video', duration: 10000,
  storage: 'cloud', revision: 1,
  cues: Array.from({ length: 2001 }, (_, i) => ({ id: `cue-${i + 1}`, start: i * 4, end: i * 4 + 3, en: `Line ${i + 1}.`, zh: '' })),
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSpeakingLibrary).mockReturnValue({ materials: [material], store: emptySpeakingStore(), scope: 'user', loading: false, error: '', catalogError: '', cloud: true, loadingMore: false, moreError: '', hasMore: false, loadMore: jest.fn(), accept: jest.fn(), refresh: jest.fn() });
  jest.mocked(saveSpeakingMaterialSubtitles).mockResolvedValue(emptySpeakingStore());
});
it('renders only 20 movie captions at once and retains corrections when jumping between pages', async () => {
  const view = await render(<SpeakingEditorScreen />);
  expect(view.getByLabelText('第 20 句英文')).toBeTruthy();
  expect(view.queryByLabelText('第 21 句英文')).toBeNull();
  await fireEvent.changeText(view.getByLabelText('第 1 句英文'), 'Corrected first line.');
  await fireEvent.changeText(view.getByLabelText('跳转字幕句号'), '2001');
  await fireEvent.press(view.getByText('跳转'));
  expect(view.getByLabelText('第 2001 句英文')).toBeTruthy();
  expect(view.getByLabelText('第 2001 句开始时间').props.value).toBe('02:13:20.000');
  expect(view.queryByLabelText('第 1 句英文')).toBeNull();
  await fireEvent.press(view.getByText('保存并开始跟读'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/speaking/shadowing', params: { id: 'film' } }));
  expect(saveSpeakingMaterialSubtitles).toHaveBeenCalledWith(material, 'user', expect.arrayContaining([expect.objectContaining({ id: 'cue-1', en: 'Corrected first line.' })]));
  expect(jest.mocked(saveSpeakingMaterialSubtitles).mock.calls[0]![2]).toHaveLength(2001);
});
