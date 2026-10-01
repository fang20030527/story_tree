import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import React from 'react';
import { createIdempotencyKey } from '@/api/installation';
import { createSpeakingAsset, createSpeakingMaterial, uploadSpeakingAssetContent } from '@/api/speaking';
import { speakingMediaInfo, readSpeakingSubtitle } from './mediaStorage';
import { emptySpeakingStore } from './model';
import { speakingStorageKey, updateSpeakingStore } from './speakingStorage';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingImportScreen } from './SpeakingImportScreen';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('@/api/installation', () => ({ createIdempotencyKey: jest.fn() }));
jest.mock('@/api/speaking', () => ({ createSpeakingAsset: jest.fn(), createSpeakingMaterial: jest.fn(), uploadSpeakingAssetContent: jest.fn() }));
jest.mock('./mediaStorage', () => ({ MAX_MEDIA_BYTES: 100 * 1024 * 1024, speakingMediaInfo: jest.fn(), readSpeakingSubtitle: jest.fn(), persistSpeakingMedia: jest.fn() }));
jest.mock('./speakingStorage', () => ({ speakingStorageKey: jest.fn(), updateSpeakingStore: jest.fn() }));
jest.mock('./useSpeakingLibrary', () => ({ useSpeakingLibrary: jest.fn() }));
jest.mock('./SpeakingComponents', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SpeakingHeader: ({ title }: { title: string }) => React.createElement(Text, null, title),
    SpeakingButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) => React.createElement(Pressable, { onPress, disabled, accessibilityLabel: label }, React.createElement(Text, null, label)),
    speakingStyles: {},
  };
});
const scope = 'speaking:v1:11111111-1111-4111-8111-111111111111';
const asset = { id: '11111111-1111-4111-8111-111111111111', status: 'awaiting_upload' as const, contentType: 'video/mp4' as const, byteSize: 2 * 1024 * 1024 * 1024, duration: 7200, uploadPath: '/v1/speaking/assets/11111111-1111-4111-8111-111111111111/content', expiresAt: '2026-10-02T00:00:00.000Z' };
const cues = [{ id: 'cue-1', start: 1, end: 4, en: 'Hello there.', zh: '' }];
const material = { id: asset.id, title: 'Movie', subtitle: '我的跟读文件', category: '个人文件', sourceKind: 'file' as const, mediaType: 'video' as const, assetId: asset.id, videoId: null, duration: 7200, cues, revision: 1, createdAt: '2026-10-01T00:00:00.000Z' };
beforeEach(() => {
  jest.clearAllMocks();
  let key = 0; jest.mocked(createIdempotencyKey).mockImplementation(async () => `key-${key++}`);
  jest.mocked(useSpeakingLibrary).mockReturnValue({ scope, store: emptySpeakingStore(), materials: [], cloud: true, loading: false, error: '', catalogError: '', loadingMore: false, moreError: '', hasMore: false, loadMore: jest.fn(), accept: jest.fn(), refresh: jest.fn() });
  jest.mocked(speakingStorageKey).mockResolvedValue(scope);
  jest.mocked(speakingMediaInfo).mockResolvedValue({ byteSize: asset.byteSize, contentType: 'video/mp4' });
  jest.mocked(readSpeakingSubtitle).mockResolvedValue('1\n00:00:01,000 --> 00:00:04,000\nHello there.');
  jest.mocked(createSpeakingAsset).mockResolvedValue(asset);
  jest.mocked(uploadSpeakingAssetContent).mockResolvedValue({ ...asset, status: 'ready' });
  jest.mocked(updateSpeakingStore).mockImplementation(async update => { const store = emptySpeakingStore(); update(store); return store; });
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///movie.mp4', name: 'Movie.mp4', mimeType: 'video/mp4', size: asset.byteSize, lastModified: 0 }] })
    .mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///movie.srt', name: 'movie.srt', lastModified: 0 }] });
});
it('requires supplied captions and retries a lost material response without reuploading the movie', async () => {
  jest.mocked(createSpeakingMaterial).mockRejectedValueOnce(new Error('网络响应中断，请重试')).mockResolvedValueOnce(material);
  const view = await render(<SpeakingImportScreen />);
  await fireEvent.press(view.getByText('选择音频或视频'));
  await waitFor(() => expect(view.getByText('Movie.mp4')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('保存并校正字幕'));
  expect(createSpeakingAsset).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('导入已有字幕'));
  await waitFor(() => expect(view.getByText('movie.srt')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('保存并校正字幕'));
  await waitFor(() => expect(view.getByText('网络响应中断，请重试')).toBeTruthy());
  expect(router.replace).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('保存并校正字幕'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/speaking/edit', params: { id: asset.id } }));
  expect(createSpeakingAsset).toHaveBeenCalledTimes(1);
  expect(uploadSpeakingAssetContent).toHaveBeenCalledTimes(1);
  expect(createSpeakingMaterial).toHaveBeenNthCalledWith(1, { sourceKind: 'file', assetId: asset.id, title: 'Movie', cues }, 'key-1');
  expect(createSpeakingMaterial).toHaveBeenNthCalledWith(2, { sourceKind: 'file', assetId: asset.id, title: 'Movie', cues }, 'key-1');
});
it('renews an expired direct upload using the original asset creation key after a canceled upload', async () => {
  const expired = { ...asset, directUpload: { url: 'https://r2.example.test/private?signature=expired', expiresAt: new Date(Date.now() - 1000).toISOString() } };
  const renewed = { ...expired, directUpload: { ...expired.directUpload, expiresAt: new Date(Date.now() + 600_000).toISOString() } };
  jest.mocked(createSpeakingAsset).mockResolvedValueOnce(expired).mockResolvedValueOnce(renewed);
  jest.mocked(uploadSpeakingAssetContent).mockRejectedValueOnce(new Error('上传已取消，可以重试')).mockResolvedValueOnce({ ...renewed, status: 'ready' });
  jest.mocked(createSpeakingMaterial).mockResolvedValue(material);
  const view = await render(<SpeakingImportScreen />);
  await fireEvent.press(view.getByText('选择音频或视频'));
  await waitFor(() => expect(view.getByText('Movie.mp4')).toBeTruthy());
  await fireEvent.press(view.getByText('导入已有字幕'));
  await waitFor(() => expect(view.getByText('movie.srt')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('保存并校正字幕'));
  await waitFor(() => expect(view.getByText('上传已取消，可以重试')).toBeTruthy());
  expect(router.replace).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('保存并校正字幕'));
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  expect(createSpeakingAsset).toHaveBeenCalledTimes(2);
  expect(jest.mocked(createSpeakingAsset).mock.calls[0]).toEqual(jest.mocked(createSpeakingAsset).mock.calls[1]);
  expect(uploadSpeakingAssetContent).toHaveBeenNthCalledWith(2, renewed, expect.anything(), expect.objectContaining({ signal: expect.anything() }));
});
