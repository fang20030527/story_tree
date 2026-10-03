import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
import { speakingMediaKind } from './mediaTypes';
import { pickSpeakingAlbum } from './importMedia';
import { downloadSpeakingRemoteMedia } from '@/api/speakingImport';
import { readIncomingSpeakingShare } from './incomingShare';
import { speakingImportSource, speakingImportSources, type SpeakingImportSource } from './importSources';
import { SpeakingImportSources } from './SpeakingImportSources';
import { SpeakingComputerImport } from './SpeakingComputerImport';
import { SpeakingManualSubtitles } from './SpeakingManualSubtitles';

export function SpeakingImportScreen() {
  const { theme } = useAppTheme();
  const library = useSpeakingLibrary();
  const params = useLocalSearchParams<{ source?: string; share?: string }>();
  const sourceRoute = `${params.source ?? ''}:${params.share ?? ''}`;
  const [sourceChoice, setSourceChoice] = useState(() => ({ route: sourceRoute, value: speakingImportSource(params.source) }));
  const source = sourceChoice.route === sourceRoute ? sourceChoice.value : speakingImportSource(params.source);
  const setSource = (value: SpeakingImportSource) => setSourceChoice({ route: sourceRoute, value });
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset>();
  const [title, setTitle] = useState('');
  const [cues, setCues] = useState<SpeakingCue[]>([]);
  const [subtitleName, setSubtitleName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [uploading, setUploading] = useState(false);
  const [savedId, setSavedId] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const mediaRelease = useRef<(() => void) | undefined>(undefined);
  const uploadController = useRef<AbortController | null>(null);
  const persisted = useRef<{ asset: DocumentPicker.DocumentPickerAsset; id: string } | undefined>(undefined);
  const cloudImport = useRef<{ assetKey: string; asset?: SpeakingAssetDto; fingerprint?: string; materialKey?: string; material?: SpeakingMaterialDto } | undefined>(undefined);
  const working = busy || selecting;
  usePreventRemove(working, () => setError('文件正在读取或保存，请先取消或等待完成'));
  useEffect(() => () => { uploadController.current?.abort(); mediaRelease.current?.(); }, []);
  const selectMedia = (file: DocumentPicker.DocumentPickerAsset, release?: () => void, incoming = false) => {
    try {
      if ((file.size ?? 0) > (library.cloud || incoming ? SPEAKING_MAX_MEDIA_BYTES : MAX_MEDIA_BYTES)) throw new Error(library.cloud || incoming ? '文件不能超过 3 GB' : '本地文件不能超过 100 MB，登录后可上传最多 3 GB');
      speakingMediaKind(file.name, file.mimeType);
      mediaRelease.current?.(); mediaRelease.current = release;
      if (asset && asset.uri !== file.uri) { setCues([]); setSubtitleName(''); }
      setAsset(file); setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 180));
      persisted.current = undefined; cloudImport.current = undefined;
    } catch (failure) { release?.(); throw failure; }
  };
  useEffect(() => {
    if (params.source !== 'shared') return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return undefined;
      setSelecting(true); setError('');
      return readIncomingSpeakingShare();
    }).then(async incoming => {
      if (!incoming) return;
      if (!active) { incoming.release(); return; }
      try {
        const subtitles = incoming.subtitle ? parseSpeakingSubtitles(await readSpeakingSubtitle(incoming.subtitle.asset)) : undefined;
        if (!active) { incoming.release(); return; }
        if (incoming.media) {
          selectMedia(incoming.media.asset, incoming.release, true);
          setNotice('已接收分享的音视频，请确认标题和字幕后保存。');
        } else {
          incoming.release();
          if (incoming.url) { setAsset(undefined); mediaRelease.current?.(); mediaRelease.current = undefined;
            setLink(incoming.url); setSource('url'); setNotice('已接收分享链接，点击读取音视频后继续。'); }
          else setNotice('已接收字幕，请再选择对应的音视频。');
        }
        if (subtitles) { setCues(subtitles); setSubtitleName(incoming.subtitle!.asset.name); }
      } catch (failure) { incoming.release(); throw failure; }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : '分享内容读取失败，请重新分享'); })
      .finally(() => { if (active) setSelecting(false); });
    return () => { active = false; };
    // 分享事件独立于账号库刷新，避免刷新时重复消费系统文件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.source, params.share]);
  useEffect(() => { if (savedId && !busy) router.replace({ pathname: '/speaking/edit', params: { id: savedId } }); }, [savedId, busy]);
  const pick = async (subtitle: boolean) => {
    if (working) return;
    setError('');
    setSelecting(true);
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
        selectMedia(file);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '文件选择失败，请重试'); }
    finally { setSelecting(false); }
  };
  const album = async () => {
    if (working) return;
    setSelecting(true); setError('');
    try { const file = await pickSpeakingAlbum(); if (file) selectMedia(file); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '相册读取失败，请重试'); }
    finally { setSelecting(false); }
  };
  const chooseSource = (next: SpeakingImportSource) => {
    if (working) return;
    setSource(next); setError(''); setNotice('');
    if (next === 'album') void album();
    if (next === 'drive' || next === 'local') void pick(false);
  };
  const download = async () => {
    if (working) return;
    setSelecting(true); setError(''); setPhase('正在读取网页音视频…');
    const controller = new AbortController(); uploadController.current = controller;
    try {
      const selected = await downloadSpeakingRemoteMedia(link, { signal: controller.signal });
      selectMedia(selected.asset, selected.release);
      setNotice('音视频已读取，请导入对应字幕或手动添加。');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '网页导入失败，请重试'); }
    finally { setSelecting(false); setPhase(''); uploadController.current = null; }
  };
  const save = async () => {
    if (!asset || working || !library.scope || library.loading || library.error) return;
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
        mediaType: speakingMediaKind(asset.name, asset.mimeType),
        mediaId, duration: 0, cues, createdAt: new Date().toISOString(),
      };
      if (!material.id) material.id = `file-${speakingId()}`;
      await updateSpeakingStore(store => { if (!store.files.some(item => item.id === material.id)) store.files.push(material); }, library.scope);
      setSavedId(material.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '文件保存失败，请重试'); }
    finally { setBusy(false); setUploading(false); uploadController.current = null; setPhase(''); }
  };
  const pickerStyle = { backgroundColor: theme.surfaceAlt, paddingVertical: 18, paddingHorizontal: 18, minHeight: 76, marginBottom: 12, borderRadius: radius.card };
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="导入跟读文件" /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={speakingStyles.content}>
    <Text style={[speakingStyles.heading, { color: theme.text }]}>喜欢的声音，{ '\n' }带进自己的练习。</Text><Text style={[speakingStyles.hint, { color: theme.textMuted, marginBottom: 28 }]}>{library.cloud ? '音视频和字幕保存到你的账号，可在其他设备继续跟读。' : '当前使用本地文件。登录后可将带字幕的音视频保存到云端。'}</Text>
    {!library.cloud ? <Pressable accessibilityRole="button" disabled={working} onPress={() => router.push('/login')} style={{ minHeight: 44, marginBottom: 12 }}><Text style={{ color: theme.accent }}>登录并使用云端文件 →</Text></Pressable> : null}
    <SpeakingImportSources selected={source} disabled={working} onSelect={chooseSource} />
    <Text style={[speakingStyles.hint, { color: theme.textMuted, marginBottom: 12 }]}>{speakingImportSources.find(item => item.id === source)?.hint}</Text>
    {source === 'computer' ? <SpeakingComputerImport cloud={library.cloud} loading={library.loading} onPick={() => { setSource('local'); void pick(false); }} onRefresh={() => { library.refresh(); router.replace('/(tabs)/shelf'); }} /> : null}
    {source === 'shared' ? <View style={{ gap: 12, marginBottom: 18 }}><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{Platform.OS === 'web' ? '请在黑洞英语手机 App 中接收分享；浏览器可直接使用本地文件或网页链接导入。' : '在其他 App 找到文件，点击「分享」或「在其他应用中打开」，选择「黑洞英语」。支持一份音视频和一份 SRT／VTT 字幕，也可分享网页链接。'}</Text></View> : null}
    {source === 'url' ? <View style={{ gap: 12, marginBottom: 18 }}><TextInput accessibilityLabel="音视频或网页链接" value={link} onChangeText={value => { setLink(value); if (asset) { setCues([]); setSubtitleName(''); } setAsset(undefined); setNotice(''); mediaRelease.current?.(); mediaRelease.current = undefined; cloudImport.current = undefined; }} editable={!working} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2048} placeholder="https://…" placeholderTextColor={theme.textMuted} style={[speakingStyles.input, { color: theme.text, borderColor: theme.border }]} /><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>网页音视频最多 100 MB。需要登录或受保护的网站，请先下载文件再导入。</Text><SpeakingButton label={selecting && phase ? phase : '读取链接中的音视频'} disabled={!link.trim() || working} onPress={() => void download()} />{selecting && phase ? <Pressable accessibilityRole="button" onPress={() => uploadController.current?.abort()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent }}>取消下载</Text></Pressable> : null}</View> : null}
    {notice ? <Text accessibilityRole="alert" style={[speakingStyles.hint, { color: theme.accent, marginBottom: 12 }]}>{notice}</Text> : null}
    {source !== 'computer' ? <>
    <Pressable accessibilityRole="button" disabled={working} onPress={() => void (source === 'album' ? album() : pick(false))} style={pickerStyle}><Text style={{ color: theme.accent, fontSize: 17, fontWeight: '600' }}>{asset ? asset.name : source === 'album' ? '选择相册视频' : '选择音频或视频'}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>MP3、M4A、WAV、MP4 等 · {library.cloud ? '最多 3 GB' : '本地最多 100 MB'}</Text></Pressable>
    <Text style={[speakingStyles.hint, { color: theme.textMuted, marginBottom: 8 }]}>文件标题</Text><TextInput accessibilityLabel="跟读文件标题" maxLength={180} value={title} onChangeText={setTitle} editable={!working} style={[speakingStyles.input, { borderColor: theme.border, color: theme.text }]} />
    <Text style={[speakingStyles.section, { color: theme.text }]}>字幕来源</Text>
    <Pressable disabled={working} accessibilityRole="button" onPress={() => void pick(true)} style={pickerStyle}><Text style={{ color: theme.accent, fontSize: 16, fontWeight: '600' }}>{subtitleName || '导入已有字幕'}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{cues.length ? `已读取 ${cues.length} 句，保存后可以校正` : '支持 SRT／VTT，也可以手动添加'}</Text></Pressable>
    <SpeakingManualSubtitles cues={cues} disabled={working} onChange={next => { setCues(next); setSubtitleName(`已添加 ${next.length} 句字幕`); }} />
    <View style={{ paddingVertical: 14, marginBottom: 12 }}><Text style={{ color: theme.textMuted, fontSize: 16 }}>先从已有字幕开始</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{library.cloud ? '导入 SRT／VTT，或手动添加至少一句字幕后即可保存到账号。无字幕文件的自动识别尚未开放。' : '可以导入字幕，或保存到设备后手动添加。无字幕文件的自动识别尚未开放。'}</Text></View>
    </> : null}
    {error || library.error ? <Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{error || library.error}</Text> : null}
    {library.error ? <Pressable accessibilityRole="button" onPress={library.refresh} style={{ minHeight: 44 }}><Text style={{ color: theme.accent }}>重试读取文件库</Text></Pressable> : null}
    {source !== 'computer' ? <SpeakingButton label={busy ? phase || '正在保存…' : '保存并校正字幕'} disabled={!asset || working || library.loading || Boolean(library.error) || (library.cloud && !cues.length)} onPress={() => void save()} /> : null}
    {uploading ? <Pressable accessibilityRole="button" onPress={() => uploadController.current?.abort()} style={{ minHeight: 44, paddingTop: 12 }}><Text style={{ color: theme.textMuted }}>取消上传</Text></Pressable> : null}
  </ScrollView></View>;
}
