import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingId, type SpeakingCue, type SpeakingMaterial } from './model';
import { MAX_MEDIA_BYTES, persistSpeakingMedia, readSpeakingSubtitle, speakingMediaInfo } from './mediaStorage';
import { parseSpeakingSubtitles, validateSpeakingCues } from './subtitles';
import { speakingStorageKey, updateSpeakingStore } from './speakingStorage';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingButton, SpeakingHeader, speakingStyles } from './SpeakingComponents';
import { SPEAKING_MAX_MEDIA_BYTES, type SpeakingAssetDto, type SpeakingMaterialDto } from '@context-reader/contracts';
import { createSpeakingAsset, createSpeakingMaterial, uploadSpeakingAssetContent } from '@/api/speaking';
import { createIdempotencyKey } from '@/api/installation';
import { cacheSpeakingMaterial } from './cloudSync';

export function SpeakingImportScreen() {
  const { theme } = useAppTheme();
  const library = useSpeakingLibrary();
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset>();
  const [title, setTitle] = useState('');
  const [cues, setCues] = useState<SpeakingCue[]>([]);
  const [subtitleName, setSubtitleName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [uploading, setUploading] = useState(false);
  const [savedId, setSavedId] = useState('');
  const uploadController = useRef<AbortController | null>(null);
  const persisted = useRef<{ asset: DocumentPicker.DocumentPickerAsset; id: string } | undefined>(undefined);
  const cloudImport = useRef<{ assetKey: string; asset?: SpeakingAssetDto; fingerprint?: string; materialKey?: string; material?: SpeakingMaterialDto } | undefined>(undefined);
  usePreventRemove(busy, () => setError('文件正在保存，请先取消上传或等待完成'));
  useEffect(() => { if (savedId && !busy) router.replace({ pathname: '/speaking/edit', params: { id: savedId } }); }, [savedId, busy]);
  const pick = async (subtitle: boolean) => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: subtitle ? '*/*' : ['audio/*', 'video/*'], copyToCacheDirectory: true, base64: false });
      if (result.canceled) return;
      const file = result.assets[0];
      if (!file) return;
      if (subtitle) {
        if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error('请选择 SRT 或 VTT 字幕');
        setCues(parseSpeakingSubtitles(await readSpeakingSubtitle(file)));
        setSubtitleName(file.name);
      } else {
        if ((file.size ?? 0) > (library.cloud ? SPEAKING_MAX_MEDIA_BYTES : MAX_MEDIA_BYTES)) throw new Error(library.cloud ? '文件不能超过 3 GB' : '本地文件不能超过 100 MB，登录后可上传最多 3 GB');
        if (!/^(audio|video)\//.test(file.mimeType ?? '') && !/\.(mp3|m4a|wav|aac|ogg|webm|mp4|mov|m4v)$/i.test(file.name)) throw new Error('请选择音频或视频文件');
        setAsset(file); setTitle(file.name.replace(/\.[^.]+$/, '')); persisted.current = undefined; cloudImport.current = undefined;
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '文件选择失败，请重试'); }
  };
  const save = async () => {
    if (!asset || busy || !library.scope || library.loading || library.error) return;
    if (!title.trim()) { setError('请为文件填写标题'); return; }
    setBusy(true); setError('');
    try {
      if (await speakingStorageKey() !== library.scope) throw new Error('登录状态已变化，请重新打开导入页面');
      if (library.cloud) {
        validateSpeakingCues(cues);
        if (!cloudImport.current) cloudImport.current = { assetKey: await createIdempotencyKey() };
        const checkpoint = cloudImport.current;
        const info = await speakingMediaInfo(asset);
        if (info.byteSize > SPEAKING_MAX_MEDIA_BYTES) throw new Error('文件不能超过 3 GB');
        if (!checkpoint.asset || (checkpoint.asset.status !== 'ready' && checkpoint.asset.directUpload && Date.parse(checkpoint.asset.directUpload.expiresAt) <= Date.now() + 5_000)) {
          setPhase('正在准备上传…');
          checkpoint.asset = await createSpeakingAsset({ ...info, purpose: 'material' }, checkpoint.assetKey);
        }
        if (checkpoint.asset.status !== 'ready') {
          setPhase('正在上传音视频…');
          setUploading(true);
          const controller = new AbortController(); uploadController.current = controller;
          checkpoint.asset = await uploadSpeakingAssetContent(checkpoint.asset, asset, { signal: controller.signal, onProgress: fraction => setPhase(`正在上传 ${Math.round(fraction * 100)}%…`) });
          uploadController.current = null;
          setUploading(false);
        }
        const fingerprint = JSON.stringify({ title: title.trim(), cues });
        if (checkpoint.fingerprint !== fingerprint) {
          checkpoint.fingerprint = fingerprint; checkpoint.materialKey = await createIdempotencyKey(); checkpoint.material = undefined;
        }
        setPhase('正在保存字幕…');
        if (!checkpoint.material) checkpoint.material = await createSpeakingMaterial({ sourceKind: 'file', assetId: checkpoint.asset.id, title: title.trim(), cues }, checkpoint.materialKey!);
        const material = checkpoint.material;
        await updateSpeakingStore(store => cacheSpeakingMaterial(store, material), library.scope);
        setSavedId(material.id);
        return;
      }
      setPhase('正在保存到设备…');
      const mediaId = persisted.current?.asset === asset ? persisted.current.id : await persistSpeakingMedia(asset);
      persisted.current = { asset, id: mediaId };
      const material: SpeakingMaterial = {
        id: `file-${mediaId.split('/').at(-1)}`, title: title.trim(), subtitle: '我的跟读文件', category: '个人文件', origin: 'file',
        mediaType: /^video\//.test(asset.mimeType ?? '') || /\.(mp4|mov|m4v)$/i.test(asset.name) ? 'video' : 'audio',
        mediaId, duration: 0, cues, createdAt: new Date().toISOString(),
      };
      if (!material.id) material.id = `file-${speakingId()}`;
      await updateSpeakingStore(store => { if (!store.files.some(item => item.id === material.id)) store.files.push(material); }, library.scope);
      setSavedId(material.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '文件保存失败，请重试'); }
    finally { setBusy(false); setUploading(false); uploadController.current = null; setPhase(''); }
  };
  const pickerStyle = { borderWidth: 1, borderStyle: 'dashed' as const, borderColor: theme.textMuted, paddingVertical: 18, paddingHorizontal: 18, minHeight: 76, marginBottom: 12, borderRadius: radius.content };
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="导入跟读文件" /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={speakingStyles.content}>
    <Text style={[speakingStyles.heading, { color: theme.text }]}>喜欢的声音，{ '\n' }带进自己的练习。</Text><Text style={[speakingStyles.hint, { color: theme.textMuted, marginBottom: 28 }]}>{library.cloud ? '音视频和字幕保存到你的账号，可在其他设备继续跟读。' : '当前使用本地文件。登录后可将带字幕的音视频保存到云端。'}</Text>
    {!library.cloud ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push('/login')} style={{ minHeight: 44, marginBottom: 12 }}><Text style={{ color: theme.accent }}>登录并使用云端文件 →</Text></Pressable> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void pick(false)} style={pickerStyle}><Text style={{ color: theme.accent, fontSize: 17, fontWeight: '600' }}>{asset ? asset.name : '选择音频或视频'}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>MP3、M4A、WAV、MP4 等 · {library.cloud ? '最多 3 GB' : '本地最多 100 MB'}</Text></Pressable>
    <Text style={[speakingStyles.hint, { color: theme.textMuted, marginBottom: 8 }]}>文件标题</Text><TextInput accessibilityLabel="跟读文件标题" maxLength={180} value={title} onChangeText={setTitle} editable={!busy} style={[speakingStyles.input, { borderColor: theme.border, color: theme.text }]} />
    <Text style={[speakingStyles.section, { color: theme.text }]}>字幕来源</Text>
    <Pressable disabled={busy} accessibilityRole="button" onPress={() => void pick(true)} style={pickerStyle}><Text style={{ color: theme.accent, fontSize: 16, fontWeight: '600' }}>{subtitleName || '导入已有字幕'}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{cues.length ? `已读取 ${cues.length} 句，保存后可以校正` : '支持 SRT／VTT，也可以手动添加'}</Text></Pressable>
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingVertical: 14, marginBottom: 12 }}><Text style={{ color: theme.textMuted, fontSize: 16 }}>先从已有字幕开始</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{library.cloud ? '云端导入需要 SRT／VTT 字幕。无字幕文件的自动识别尚未开放。' : '可以导入字幕，或保存到设备后手动添加。无字幕文件的自动识别尚未开放。'}</Text></View>
    {error || library.error ? <Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{error || library.error}</Text> : null}
    {library.error ? <Pressable accessibilityRole="button" onPress={library.refresh} style={{ minHeight: 44 }}><Text style={{ color: theme.accent }}>重试读取文件库</Text></Pressable> : null}
    <SpeakingButton label={busy ? phase || '正在保存…' : '保存并校正字幕'} disabled={!asset || busy || library.loading || Boolean(library.error) || (library.cloud && !cues.length)} onPress={() => void save()} />
    {uploading ? <Pressable accessibilityRole="button" onPress={() => uploadController.current?.abort()} style={{ minHeight: 44, paddingTop: 12 }}><Text style={{ color: theme.textMuted }}>取消上传</Text></Pressable> : null}
  </ScrollView></View>;
}
