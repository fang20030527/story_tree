import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { createIdempotencyKey } from '@/api/installation';
import { createSpeakingAsset, createSpeakingMaterial, uploadSpeakingAssetContent } from '@/api/speaking';
import { speakingMediaInfo, readSpeakingSubtitle } from './mediaStorage';
import { emptySpeakingStore } from './model';
import { speakingStorageKey, updateSpeakingStore } from './speakingStorage';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingImportScreen } from './SpeakingImportScreen';
import { pickSpeakingAlbum } from './importMedia';
import { readIncomingSpeakingShare } from './incomingShare';
import { downloadSpeakingRemoteMedia } from '@/api/speakingImport';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() }, useLocalSearchParams: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('./importMedia', () => ({ pickSpeakingAlbum: jest.fn() }));
jest.mock('./incomingShare', () => ({ readIncomingSpeakingShare: jest.fn() }));
jest.mock('@/api/speakingImport', () => ({ downloadSpeakingRemoteMedia: jest.fn() }));
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
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(readIncomingSpeakingShare).mockResolvedValue(undefined);
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset();
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
it('imports audio from the system drive picker and accepts manually timed subtitles', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset().mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///podcast.mp3', name: 'Podcast.mp3', mimeType: 'audio/mpeg', size: 100, lastModified: 0 }] });
  jest.mocked(speakingMediaInfo).mockResolvedValue({ byteSize: 100, contentType: 'audio/mpeg' });
  jest.mocked(createSpeakingMaterial).mockResolvedValue({ ...material, title: 'Podcast', mediaType: 'audio' });
  const view = await render(<SpeakingImportScreen />);
  for (const name of ['网盘', '相册', '网页链接', '本地', '电脑', '其他 App']) expect(view.getByLabelText(`从${name}导入`)).toBeTruthy();
  await fireEvent.press(view.getByLabelText('从网盘导入'));
  await waitFor(() => expect(view.getByText('Podcast.mp3')).toBeTruthy());
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: ['audio/*', 'video/*'], copyToCacheDirectory: true }));
  await fireEvent.press(view.getByText('手动添加字幕'));
  await fireEvent.changeText(view.getByLabelText('手动字幕英文'), 'Listen to this podcast.');
  await fireEvent.press(view.getByText('＋ 加入这句字幕'));
  await fireEvent.press(view.getByLabelText('保存并校正字幕'));
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  expect(createSpeakingAsset).toHaveBeenCalledWith({ byteSize: 100, contentType: 'audio/mpeg', purpose: 'material' }, expect.any(String));
  expect(createSpeakingMaterial).toHaveBeenCalledWith(expect.objectContaining({ title: 'Podcast', cues: [expect.objectContaining({ start: 0, end: 5, en: 'Listen to this podcast.' })] }), expect.any(String));
});
it('uses the album picker and preserves the selected media when album selection is canceled', async () => {
  jest.mocked(pickSpeakingAlbum).mockResolvedValueOnce({ uri: 'file:///album.mov', name: 'Album.mov', mimeType: 'video/quicktime', size: 100, lastModified: 0 }).mockResolvedValueOnce(undefined);
  const view = await render(<SpeakingImportScreen />);
  await fireEvent.press(view.getByLabelText('从相册导入'));
  await waitFor(() => expect(view.getByText('Album.mov')).toBeTruthy());
  await fireEvent.press(view.getByText('Album.mov'));
  await waitFor(() => expect(pickSpeakingAlbum).toHaveBeenCalledTimes(2));
  expect(view.getByText('Album.mov')).toBeTruthy(); expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
});
it('downloads a URL into the existing file flow and clears stale media when the URL changes', async () => {
  const release = jest.fn();
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset().mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///remote.srt', name: 'Remote.srt', lastModified: 0 }] });
  jest.mocked(downloadSpeakingRemoteMedia).mockResolvedValue({ asset: { uri: 'file:///remote.wav', name: '网页音视频.wav', mimeType: 'audio/wav', size: 100, lastModified: 0 }, release });
  const view = await render(<SpeakingImportScreen />);
  await fireEvent.press(view.getByLabelText('从网页链接导入'));
  await fireEvent.changeText(view.getByLabelText('音视频或网页链接'), 'https://example.com/podcast');
  await fireEvent.press(view.getByLabelText('读取链接中的音视频'));
  await waitFor(() => expect(view.getByText('网页音视频.wav')).toBeTruthy());
  expect(downloadSpeakingRemoteMedia).toHaveBeenCalledWith('https://example.com/podcast', expect.objectContaining({ signal: expect.anything() }));
  await fireEvent.press(view.getByText('导入已有字幕'));
  await waitFor(() => expect(view.getByText('Remote.srt')).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText('音视频或网页链接'), 'https://example.com/other');
  expect(view.queryByText('网页音视频.wav')).toBeNull(); expect(release).toHaveBeenCalledTimes(1);
  expect(view.queryByText('Remote.srt')).toBeNull();
  await fireEvent.press(view.getByLabelText('保存并校正字幕')); expect(createSpeakingAsset).not.toHaveBeenCalled();
});
it('receives a shared media and subtitle pair and retains it until saving finishes', async () => {
  const release = jest.fn();
  jest.mocked(useLocalSearchParams).mockReturnValue({ source: 'shared', share: 'event-1' });
  jest.mocked(readIncomingSpeakingShare).mockResolvedValue({ media: { asset: { uri: 'file:///shared.mp4', name: 'Shared.mp4', mimeType: 'video/mp4', size: asset.byteSize, lastModified: 0 }, release: jest.fn() },
    subtitle: { asset: { uri: 'file:///shared.srt', name: 'Shared.srt', lastModified: 0 }, release: jest.fn() }, release });
  jest.mocked(createSpeakingMaterial).mockResolvedValue({ ...material, title: 'Shared' });
  const view = await render(<SpeakingImportScreen />);
  await waitFor(() => expect(view.getByText('Shared.srt')).toBeTruthy());
  expect(release).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('保存并校正字幕'));
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  expect(createSpeakingMaterial).toHaveBeenCalledWith({ sourceKind: 'file', assetId: asset.id, title: 'Shared', cues }, expect.any(String));
  await view.unmount(); expect(release).toHaveBeenCalledTimes(1);
});
it('prefills a shared link without starting a network download automatically', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ source: 'shared', share: 'event-2' });
  jest.mocked(readIncomingSpeakingShare).mockResolvedValue({ url: 'https://example.com/audio.mp3', release: jest.fn() });
  const view = await render(<SpeakingImportScreen />);
  await waitFor(() => expect(view.getByDisplayValue('https://example.com/audio.mp3')).toBeTruthy());
  expect(downloadSpeakingRemoteMedia).not.toHaveBeenCalled();
});
it('refreshes computer uploads through the account file library', async () => {
  const view = await render(<SpeakingImportScreen />);
  await fireEvent.press(view.getByLabelText('从电脑导入'));
  expect(view.getByText('在电脑上传，手机继续练。')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('刷新账号文件库'));
  expect(jest.mocked(useSpeakingLibrary).mock.results.at(-1)?.value.refresh).toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/(tabs)/shelf'); expect(createSpeakingAsset).not.toHaveBeenCalled();
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
