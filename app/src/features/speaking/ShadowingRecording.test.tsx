import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AudioModule, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import React from 'react';
import { ShadowingRecording } from './ShadowingRecording';
import { persistSpeakingMedia, resolveSpeakingMedia } from './mediaStorage';
import { emptySpeakingStore, type SpeakingMaterial } from './model';
import { updateSpeakingStore } from './speakingStorage';

jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn() }, RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(), useAudioPlayer: jest.fn(), useAudioPlayerStatus: jest.fn(), useAudioRecorder: jest.fn(), useAudioRecorderState: jest.fn(),
}));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]) }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('./mediaStorage', () => ({ persistSpeakingMedia: jest.fn(), resolveSpeakingMedia: jest.fn() }));
jest.mock('./speakingStorage', () => ({ updateSpeakingStore: jest.fn() }));
jest.mock('./SpeakingPronunciation', () => ({ SpeakingPronunciation: () => null }));

const recorder = { prepareToRecordAsync: jest.fn(), record: jest.fn(), stop: jest.fn(), uri: 'file:///recording.m4a' };
const replay = { pause: jest.fn(), replace: jest.fn(), seekTo: jest.fn(), play: jest.fn() };
const props = { materialId: 'curiosity', cueId: 'cue-one', scope: 'user-a', pauseOriginal: jest.fn(), onActive: jest.fn(), onSaved: jest.fn() };
const state = (isRecording: boolean) => ({ isRecording, durationMillis: 1000 } as ReturnType<typeof useAudioRecorderState>);
beforeEach(() => {
  jest.clearAllMocks();
  recorder.prepareToRecordAsync.mockResolvedValue(undefined); recorder.stop.mockResolvedValue(undefined);
  jest.mocked(useAudioRecorder).mockReturnValue(recorder as unknown as ReturnType<typeof useAudioRecorder>);
  jest.mocked(useAudioRecorderState).mockReturnValue(state(false));
  jest.mocked(useAudioPlayer).mockReturnValue(replay as unknown as ReturnType<typeof useAudioPlayer>);
  jest.mocked(useAudioPlayerStatus).mockReturnValue({ playing: false } as ReturnType<typeof useAudioPlayerStatus>);
  jest.mocked(setAudioModeAsync).mockResolvedValue(undefined);
  jest.mocked(AudioModule.requestRecordingPermissionsAsync).mockResolvedValue({ granted: true } as Awaited<ReturnType<typeof AudioModule.requestRecordingPermissionsAsync>>);
  jest.mocked(persistSpeakingMedia).mockResolvedValue('saved-recording');
});
it('requests permission only on user action and handles denial without recording', async () => {
  jest.mocked(AudioModule.requestRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as Awaited<ReturnType<typeof AudioModule.requestRecordingPermissionsAsync>>);
  const view = await render(<ShadowingRecording {...props} />);
  expect(AudioModule.requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('开始录音'));
  await waitFor(() => expect(view.getByText(/未获得麦克风权限/)).toBeTruthy());
  expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
  expect(persistSpeakingMedia).not.toHaveBeenCalled();
});
it('restores playback audio mode after a failed recorder preparation', async () => {
  recorder.prepareToRecordAsync.mockRejectedValueOnce(new Error('microphone unavailable'));
  const view = await render(<ShadowingRecording {...props} />);
  await fireEvent.press(view.getByLabelText('开始录音'));
  await waitFor(() => expect(view.getByText(/无法开始录音/)).toBeTruthy());
  expect(setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true });
  expect(recorder.record).not.toHaveBeenCalled();
});
it('retries metadata without copying the recorded media again', async () => {
  const store = emptySpeakingStore();
  jest.mocked(updateSpeakingStore).mockRejectedValueOnce(new Error('storage full')).mockImplementationOnce(async (update) => { update(store); return store; });
  const view = await render(<ShadowingRecording {...props} />);
  await fireEvent.press(view.getByLabelText('开始录音'));
  await waitFor(() => expect(recorder.record).toHaveBeenCalled());
  jest.mocked(useAudioRecorderState).mockReturnValue(state(true));
  await view.rerender(<ShadowingRecording {...props} />);
  await fireEvent.press(view.getByLabelText('停止录音'));
  await waitFor(() => expect(view.getByText('重试保存录音')).toBeTruthy());
  expect(props.onSaved).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('重试保存录音'));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(store));
  expect(persistSpeakingMedia).toHaveBeenCalledTimes(1);
  expect(updateSpeakingStore).toHaveBeenLastCalledWith(expect.any(Function), 'user-a');
  expect(store.recordings.curiosity).toEqual(expect.objectContaining({ mediaId: 'saved-recording', cueId: 'cue-one' }));
  expect(resolveSpeakingMedia).not.toHaveBeenCalled();
});
it('saves the cue text and subtitle version captured when recording began, even after cue changes during save', async () => {
  const original: SpeakingMaterial = { id: props.materialId, title: 'Practice', subtitle: '', category: '', origin: 'platform', mediaType: 'audio', duration: 5, revision: 3, cues: [{ id: 'cue-one', start: 0, end: 2, en: 'Hello there.', zh: '' }, { id: 'cue-two', start: 2, end: 5, en: 'Good morning.', zh: '' }] };
  const store = emptySpeakingStore();
  jest.mocked(updateSpeakingStore).mockImplementation(async update => { update(store); return store; });
  let finishPersist!: (id: string) => void;
  jest.mocked(persistSpeakingMedia).mockImplementationOnce(() => new Promise(resolve => { finishPersist = resolve; }));
  const view = await render(<ShadowingRecording {...props} material={original} />);
  await fireEvent.press(view.getByLabelText('开始录音'));
  await waitFor(() => expect(recorder.record).toHaveBeenCalled());
  jest.mocked(useAudioRecorderState).mockReturnValue(state(true));
  await view.rerender(<ShadowingRecording {...props} material={{ ...original, revision: 4 }} cueId="cue-two" />);
  await fireEvent.press(view.getByLabelText('停止录音'));
  await waitFor(() => expect(persistSpeakingMedia).toHaveBeenCalled());
  await view.rerender(<ShadowingRecording {...props} material={{ ...original, revision: 5 }} cueId="cue-two" />);
  await act(async () => finishPersist('captured-recording'));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(store));
  expect(store.recordings[props.materialId]).toMatchObject({ mediaId: 'captured-recording', cueId: 'cue-one', referenceText: 'Hello there.', subtitleRevision: 3 });
});
it('captures the target before the microphone permission request and ignores save responses after account changes', async () => {
  const material: SpeakingMaterial = { id: props.materialId, title: 'Practice', subtitle: '', category: '', origin: 'file', mediaType: 'audio', duration: 5, cues: [{ id: 'cue-one', start: 0, end: 2, en: 'First sentence.', zh: '' }, { id: 'cue-two', start: 2, end: 5, en: 'Second sentence.', zh: '' }] };
  let grant!: (permission: Awaited<ReturnType<typeof AudioModule.requestRecordingPermissionsAsync>>) => void;
  jest.mocked(AudioModule.requestRecordingPermissionsAsync).mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  const store = emptySpeakingStore();
  let finishSave!: () => void;
  jest.mocked(updateSpeakingStore).mockImplementationOnce(update => new Promise(resolve => { finishSave = () => { update(store); resolve(store); }; }));
  const view = await render(<ShadowingRecording {...props} material={material} />);
  await fireEvent.press(view.getByLabelText('开始录音'));
  await view.rerender(<ShadowingRecording {...props} material={material} cueId="cue-two" />);
  await act(async () => grant({ granted: true } as Awaited<ReturnType<typeof AudioModule.requestRecordingPermissionsAsync>>));
  await waitFor(() => expect(recorder.record).toHaveBeenCalled());
  jest.mocked(useAudioRecorderState).mockReturnValue(state(true));
  await view.rerender(<ShadowingRecording {...props} material={material} cueId="cue-two" />);
  await fireEvent.press(view.getByLabelText('停止录音'));
  await waitFor(() => expect(updateSpeakingStore).toHaveBeenCalled());
  await view.rerender(<ShadowingRecording {...props} scope="user-b" material={material} cueId="cue-two" />);
  await act(async () => finishSave());
  expect(updateSpeakingStore).toHaveBeenCalledWith(expect.any(Function), 'user-a');
  expect(store.recordings[props.materialId]).toMatchObject({ cueId: 'cue-one', referenceText: 'First sentence.' });
  expect(props.onSaved).not.toHaveBeenCalled();
});
