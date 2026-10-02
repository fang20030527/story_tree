import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CreateSpeakingPronunciationRequest, SpeakingPronunciationAssessmentDto, SpeakingPronunciationResult } from '@context-reader/contracts';
import { router } from 'expo-router';
import React from 'react';
import { ApiError } from '@/api/client';
import { getSpeakingCapabilities } from '@/api/speaking';
import type { SpeakingMaterial, SpeakingRecording } from './model';
import { restoreSpeakingPronunciation, submitSpeakingPronunciation } from './pronunciation';
import { speakingStorageKey } from './speakingStorage';
import { PronunciationResults, SpeakingPronunciation } from './SpeakingPronunciation';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('@/api/speaking', () => ({ getSpeakingCapabilities: jest.fn() }));
jest.mock('./speakingStorage', () => ({ speakingStorageKey: jest.fn() }));
jest.mock('./pronunciation', () => ({
  ...jest.requireActual<typeof import('./pronunciation')>('./pronunciation'),
  restoreSpeakingPronunciation: jest.fn(), submitSpeakingPronunciation: jest.fn(),
}));
const scope = 'speaking:v1:11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const material: SpeakingMaterial = { id: 'curiosity', title: 'Practice', subtitle: '', category: '', origin: 'platform', mediaType: 'audio', storage: 'cloud', revision: 2, duration: 3, cues: [{ id: 'cue-1', start: 0, end: 3, en: 'Hello there.', zh: '' }] };
const recording: SpeakingRecording = { mediaId: assetId, assetId, durationMs: 2000, cueId: 'cue-1', referenceText: 'Hello there.', subtitleRevision: 2 };
const result: SpeakingPronunciationResult = {
  score: 82.5, words: [{ word: 'Hello', score: 62, startMs: 0, endMs: 700, phonemes: [{ symbol: 'h', spokenSymbol: 'x', score: 42, stressScore: null, startMs: null, endMs: null }, { symbol: 'e', spokenSymbol: null, score: null, stressScore: null, startMs: null, endMs: null }] }, { word: 'there', score: null, startMs: null, endMs: null, phonemes: [] }],
  feedback: ['先慢读 Hello，再放回整句练习。'],
};
const request: CreateSpeakingPronunciationRequest = { assetId, materialId: material.id, cueId: recording.cueId, referenceText: recording.referenceText!, subtitleRevision: 2, locale: 'en-us' };
const assessment: SpeakingPronunciationAssessmentDto = { ...request, id: '33333333-3333-4333-8333-333333333333', provider: 'speechace', status: 'ready', result, error: null, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
const props = { materialId: material.id, material, recording, scope };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(speakingStorageKey).mockResolvedValue(scope);
  jest.mocked(getSpeakingCapabilities).mockResolvedValue({ storage: 'r2', maxMediaBytes: 1000000, maxSubtitleBytes: 1000, autoSubtitles: false, pronunciation: { available: true, provider: 'speechace', maxDurationMs: 30000, maxAudioBytes: 2 * 1024 * 1024, locales: ['en-us', 'en-gb'] } });
  jest.mocked(restoreSpeakingPronunciation).mockResolvedValue(null);
  jest.mocked(submitSpeakingPronunciation).mockResolvedValue(assessment);
});
it('renders real sentence/word/phoneme scores with readable labels and preserves missing scores', async () => {
  const view = await render(<PronunciationResults result={result} />);
  expect(view.getByText('句子发音分：82.5 分 / 100')).toBeTruthy();
  expect(view.getByText('Hello · 62 分')).toBeTruthy();
  expect(view.getByText('there · 未提供分数')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Hello，62 分，需练习，查看音素反馈'));
  expect(view.getByText('目标音素 /h/ · 42 分')).toBeTruthy();
  expect(view.getByText('目标音素 /e/ · 未提供分数')).toBeTruthy();
  expect(view.getByText(/识别为 \/x\//)).toBeTruthy();
  expect(view.getByText(/服务未提供这个音素的分数/)).toBeTruthy();
  expect(view.getByText('先慢读 Hello，再放回整句练习。')).toBeTruthy();
  expect(view.queryByText(/0 分/)).toBeNull();
});
it('waits for an explicit click to submit audio and renders the returned result', async () => {
  const view = await render(<SpeakingPronunciation {...props} />);
  await waitFor(() => expect(view.getByLabelText('发音评分')).toBeTruthy());
  expect(submitSpeakingPronunciation).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('发音评分'));
  await waitFor(() => expect(view.getByText('句子发音分：82.5 分 / 100')).toBeTruthy());
  expect(submitSpeakingPronunciation).toHaveBeenCalledWith(expect.objectContaining({ recording, scope, locale: 'en-us' }));
});
it('allows guests to open login without fetching authenticated capabilities or creating an assessment', async () => {
  const view = await render(<SpeakingPronunciation {...props} scope="speaking:v1:guest" />);
  await fireEvent.press(view.getByText('登录使用发音评分'));
  expect(router.push).toHaveBeenCalledWith('/login');
  expect(getSpeakingCapabilities).not.toHaveBeenCalled(); expect(restoreSpeakingPronunciation).not.toHaveBeenCalled(); expect(submitSpeakingPronunciation).not.toHaveBeenCalled();
});
it('reports scoring unavailable when the older server omits the capability', async () => {
  jest.mocked(getSpeakingCapabilities).mockResolvedValue({ storage: 'r2', maxMediaBytes: 1000, maxSubtitleBytes: 1000, autoSubtitles: false });
  const view = await render(<SpeakingPronunciation {...props} />);
  await waitFor(() => expect(view.getByText('发音评分暂未开放，录音仍可保存和回放。')).toBeTruthy());
  expect(view.queryByLabelText('发音评分')).toBeNull();
  expect(submitSpeakingPronunciation).not.toHaveBeenCalled();
});
it.each([
  { value: { ...recording, referenceText: undefined }, text: '这条录音没有保存目标字幕，请重新录制后评分。' },
  { value: { ...recording, durationMs: 30001 }, text: '录音超过 30 秒，请选择一句短字幕重新录制。' },
])('requires rerecording for an unusable saved recording', async ({ value, text }) => {
  const view = await render(<SpeakingPronunciation {...props} recording={value} />);
  await waitFor(() => expect(getSpeakingCapabilities).toHaveBeenCalled());
  expect(view.getByText(text)).toBeTruthy();
  expect(view.queryByLabelText('发音评分')).toBeNull();
  expect(submitSpeakingPronunciation).not.toHaveBeenCalled();
});
it('discards a late response after changing accent and submits the new accent independently', async () => {
  let complete!: (value: SpeakingPronunciationAssessmentDto) => void;
  jest.mocked(submitSpeakingPronunciation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = await render(<SpeakingPronunciation {...props} />);
  await waitFor(() => expect(view.getByLabelText('发音评分')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('发音评分'));
  await fireEvent.press(view.getByLabelText('英式发音'));
  await act(async () => complete({ ...assessment, result: { ...result, score: 99 } }));
  expect(view.queryByText(/99 分/)).toBeNull();
  await waitFor(() => expect(view.getByLabelText('发音评分')).toBeTruthy());
  jest.mocked(submitSpeakingPronunciation).mockResolvedValueOnce({ ...assessment, locale: 'en-gb' });
  await fireEvent.press(view.getByLabelText('发音评分'));
  await waitFor(() => expect(view.getByText(/句子发音分：82.5/)).toBeTruthy());
  expect(submitSpeakingPronunciation).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'en-gb' }));
  expect(jest.mocked(submitSpeakingPronunciation).mock.calls[0]![0].signal?.aborted).toBe(true);
});
it('discards the old assessment after replacing a recording', async () => {
  let complete!: (value: SpeakingPronunciationAssessmentDto) => void;
  jest.mocked(submitSpeakingPronunciation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = await render(<SpeakingPronunciation {...props} />);
  await waitFor(() => expect(view.getByLabelText('发音评分')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('发音评分'));
  const nextRecording = { ...recording, mediaId: '44444444-4444-4444-8444-444444444444', assetId: '44444444-4444-4444-8444-444444444444' };
  jest.mocked(restoreSpeakingPronunciation).mockResolvedValueOnce({ ...assessment, assetId: nextRecording.assetId, result: { ...result, score: 72 } });
  await view.rerender(<SpeakingPronunciation {...props} recording={nextRecording} />);
  await waitFor(() => expect(view.getByText(/句子发音分：72 分/)).toBeTruthy());
  await act(async () => complete({ ...assessment, result: { ...result, score: 99 } }));
  expect(view.getByText(/句子发音分：72 分/)).toBeTruthy();
  expect(view.queryByText(/99 分/)).toBeNull();
});
it('discards responses after an account changes, even before the parent refreshes its scope', async () => {
  let complete!: (value: SpeakingPronunciationAssessmentDto) => void;
  jest.mocked(submitSpeakingPronunciation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = await render(<SpeakingPronunciation {...props} />);
  await waitFor(() => expect(view.getByLabelText('发音评分')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('发音评分'));
  jest.mocked(speakingStorageKey).mockResolvedValue('speaking:v1:other-user');
  await act(async () => complete(assessment));
  expect(view.queryByText(/句子发音分/)).toBeNull();
});
it('cancels an active request on unmount and keeps its result out of the next mounted panel', async () => {
  let complete!: (value: SpeakingPronunciationAssessmentDto) => void;
  jest.mocked(submitSpeakingPronunciation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = await render(<SpeakingPronunciation {...props} />);
  await waitFor(() => expect(view.getByLabelText('发音评分')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('发音评分'));
  const signal = jest.mocked(submitSpeakingPronunciation).mock.calls[0]![0].signal;
  await view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => complete(assessment));
  const next = await render(<SpeakingPronunciation {...props} />);
  expect(next.queryByText(/句子发音分/)).toBeNull();
});
it('shows a real retryable error and allows the user to retry', async () => {
  jest.mocked(submitSpeakingPronunciation).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络中断，评分响应未收到', true));
  const view = await render(<SpeakingPronunciation {...props} />);
  await waitFor(() => expect(view.getByLabelText('发音评分')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('发音评分'));
  await waitFor(() => expect(view.getByText('网络中断，评分响应未收到')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('重试发音评分'));
  await waitFor(() => expect(view.getByText(/句子发音分：82.5/)).toBeTruthy());
  expect(submitSpeakingPronunciation).toHaveBeenCalledTimes(2);
});
it('retrieves processing results with GET recovery instead of another submission', async () => {
  jest.mocked(submitSpeakingPronunciation).mockResolvedValueOnce({ ...assessment, status: 'processing', result: null });
  const view = await render(<SpeakingPronunciation {...props} />);
  await waitFor(() => expect(view.getByLabelText('发音评分')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('发音评分'));
  await waitFor(() => expect(view.getByText('查看评分进度')).toBeTruthy());
  jest.mocked(restoreSpeakingPronunciation).mockResolvedValueOnce(assessment);
  await fireEvent.press(view.getByText('查看评分进度'));
  await waitFor(() => expect(view.getByText(/句子发音分：82.5/)).toBeTruthy());
  expect(submitSpeakingPronunciation).toHaveBeenCalledTimes(1);
});
