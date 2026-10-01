import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingAccentLabel } from './accents';
import { useEditorialAudio } from '@/features/editorial/EditorialAudioProvider';
import { curiosityNotes, speakingVocabulary } from './annotations';
import { speakingSource, speakingSourceLabel } from './catalog';
import { resolveSpeakingMedia } from './mediaStorage';
import { formatSpeakingTime, type SpeakingMaterial } from './model';
import { updateSpeakingStore } from './speakingStorage';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { useSpeakingSession } from './useSpeakingSession';
import { SpeakingHeader, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { ShadowingAudio, ShadowingVideo } from './ShadowingMedia';
import { ShadowingRecording } from './ShadowingRecording';
import { ShadowingSettings } from './ShadowingSettings';
import { ShadowingProgress } from './ShadowingProgress';
import { useShadowingPlayback } from './useShadowingPlayback';
import { ShadowingCue, type ShadowingBlock } from './ShadowingCue';
import { ShadowingDictionary } from './ShadowingDictionary';
import { saveSpeakingMaterialState } from './cloudSync';
import { getSpeakingCatalogPlayback, getSpeakingPlayback } from '@/api/speaking';
import { initialShadowingState } from './playback';
import { scrollToRenderedSubtitle } from './subtitleScrolling';
const emptySavedCues: string[] = [];

export function ShadowingScreen() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const library = useSpeakingLibrary(id);
  const material = library.materials.find(item => item.id === id);
  if (library.loading || library.error || !material || !library.scope) return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="影子跟读" /><View style={speakingStyles.content}><SpeakingStatus loading={library.loading} error={library.error} retry={library.refresh} />{!library.loading && !library.error && !material ? <Text style={{ color: theme.textMuted }}>素材不存在，请返回素材页。</Text> : null}</View></View>;
  return <ShadowingPractice key={`${library.scope}:${material.id}`} material={material} library={library} scope={library.scope} />;
}
function ShadowingPractice({ material, library, scope }: { material: SpeakingMaterial; library: ReturnType<typeof useSpeakingLibrary>; scope: string }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const splitLayout = width >= 960 || (width >= 760 && width > height);
  const [workspaceHeight, setWorkspaceHeight] = useState(Math.max(220, height - 206 - insets.top - insets.bottom));
  const [mediaWidth, setMediaWidth] = useState(0);
  const [mediaBodyHeight, setMediaBodyHeight] = useState(0);
  const measureWorkspace = useCallback((event: LayoutChangeEvent) => setWorkspaceHeight(event.nativeEvent.layout.height), []);
  const measureMedia = useCallback((event: LayoutChangeEvent) => setMediaWidth(event.nativeEvent.layout.width), []);
  const measureMediaBody = useCallback((event: LayoutChangeEvent) => setMediaBodyHeight(event.nativeEvent.layout.height), []);
  const { close: closeEditorialAudio } = useEditorialAudio();
  const playback = useShadowingPlayback(material.cues);
  const { loaded, duration, seek, playing, loop, currentTime, index } = playback;
  const reportMediaState = playback.onState;
  const [source, setSource] = useState<string | number | null>(() => speakingSource(material.id) ?? null);
  const [mediaError, setMediaError] = useState('');
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [segmented, setSegmented] = useState(true);
  const [savedOnly, setSavedOnly] = useState(false);
  const [subtitles, setSubtitles] = useState(0);
  const [masked, setMasked] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [fontSize, setFontSize] = useState(21);
  const [query, setQuery] = useState('');
  const [subtitleAnchor, setSubtitleAnchor] = useState<string | null>(null);
  const [subtitleRevision, setSubtitleRevision] = useState(0);
  const [searching, setSearching] = useState(false);
  const [settings, setSettings] = useState(false);
  const [skipGaps, setSkipGaps] = useState(false);
  const [abStart, setAbStart] = useState<number | null>(null);
  const [recordPanel, setRecordPanel] = useState(false);
  const [recordActive, setRecordActive] = useState(false);
  const [sheet, setSheet] = useState<'notes' | 'explain' | 'words' | 'dictionary' | 'more' | null>(null);
  const [word, setWord] = useState('');
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  const list = useRef<FlatList>(null);
  const webTranscript = useRef<ScrollView>(null);
  const scrollRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollAttempts = useRef(0);
  useEffect(() => () => clearTimeout(scrollRetry.current), []);
  const cue = material.cues[playback.index];
  const saved = library.store.saved[material.id] ?? emptySavedCues;
  usePreventRemove(recordActive, () => setActionError('请先停止录音或回放，再离开练习'));
  const session = useSpeakingSession(material, scope, playback.playing || recordActive, playback.currentTime, playback.index);
  const onRecordingActive = useCallback((active: boolean) => setRecordActive(active), []);
  const accept = library.accept;
  const pauseOriginal = playback.pause;
  const resumed = useRef(false);
  const resumeAt = useRef<number | null>(null);
  const resumePlaying = useRef(false);
  const livePlayback = useRef({ time: playback.currentTime, playing: playback.playing });
  useEffect(() => { if (loaded) livePlayback.current = { time: playback.currentTime, playing: playback.playing }; }, [loaded, playback.currentTime, playback.playing]);
  useEffect(() => { closeEditorialAudio(); }, [closeEditorialAudio]);
  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (material.assetId || (material.origin === 'platform' && material.mediaType === 'video')) {
      const load = async () => {
        const media = material.origin === 'platform'
          ? await getSpeakingCatalogPlayback(material.id) : await getSpeakingPlayback(material.assetId!);
        if (!active) return;
        reportMediaState(initialShadowingState);
        setSource(media.url); setMediaError('');
        refreshTimer = setTimeout(() => {
          resumeAt.current = livePlayback.current.time; resumePlaying.current = livePlayback.current.playing; resumed.current = false;
          void load().catch(() => { if (active) setMediaError('云端播放链接更新失败，请重试音视频'); });
        }, Math.max(30_000, Date.parse(media.expiresAt) - Date.now() - 15_000));
      };
      void load().catch((failure) => { if (active) setMediaError(failure instanceof Error ? failure.message : '云端音视频读取失败，请重试'); });
    } else if (material.mediaId) void resolveSpeakingMedia(material.mediaId).then(media => {
      if (!active) { media.release(); return; } release = media.release; setSource(media.uri); setMediaError('');
    }).catch(() => { if (active) setMediaError('音视频读取失败，请重试或重新导入文件'); });
    return () => { active = false; release?.(); clearTimeout(refreshTimer); };
  }, [material.mediaId, material.assetId, material.id, material.origin, material.mediaType, revision, reportMediaState]);
  useEffect(() => {
    if (!loaded || duration <= 0 || resumed.current) return;
    resumed.current = true;
    const position = resumeAt.current ?? library.store.positions[material.id] ?? 0;
    if (position < duration && (position > 0 || resumePlaying.current)) void seek(position, resumePlaying.current);
    resumeAt.current = null; resumePlaying.current = false;
    if (material.storage !== 'cloud' && material.origin === 'file' && duration > 0 && material.duration !== duration) void updateSpeakingStore(store => { const file = store.files.find(item => item.id === material.id); if (file) file.duration = duration; }, scope).then(accept).catch(() => setActionError('文件时长保存失败，请重试'));
  }, [loaded, duration, seek, material.id, material.origin, material.storage, material.duration, scope, library.store.positions, accept]);
  useEffect(() => {
    if (source === null || loaded) return;
    const timeout = setTimeout(() => setMediaError('音视频加载超时，请重试'), 15000);
    return () => clearTimeout(timeout);
  }, [source, loaded, revision]);
  const blocks = useMemo(() => material.cues.flatMap((item, index, all) => {
    if (!segmented && index % 2 === 1) return [];
    const tail = !segmented ? all[index + 1] : undefined;
    return [{ ...item, index, endIndex: tail ? index + 1 : index, en: tail ? `${item.en} ${tail.en}` : item.en, zh: tail ? `${item.zh} ${tail.zh}` : item.zh, end: tail?.end ?? item.end }];
  }).filter(item => (!savedOnly || material.cues.slice(item.index, item.endIndex + 1).some(line => saved.includes(line.id))) && (!query.trim() || `${item.en} ${item.zh}`.toLowerCase().includes(query.trim().toLowerCase()))), [material.cues, segmented, savedOnly, saved, query]);
  useEffect(() => {
    if (Platform.OS === 'web') webTranscript.current?.scrollTo({ y: 0, animated: false });
  }, [query, segmented, savedOnly]);
  const selectedBlock = blocks.findIndex(item => playback.index >= item.index && playback.index <= item.endIndex);
  const scrollToCurrent = useCallback(() => {
    clearTimeout(scrollRetry.current); scrollAttempts.current = 0;
    const target = blocks[selectedBlock];
    if (!target) return;
    if (Platform.OS === 'web') {
      if (webTranscript.current) scrollToRenderedSubtitle(webTranscript.current, `shadowing-cue-${target.index}`, splitLayout ? .3 : 0);
    } else list.current?.scrollToIndex({ index: selectedBlock, viewPosition: splitLayout ? .3 : 0, animated: true });
  }, [selectedBlock, splitLayout, blocks]);
  useEffect(() => {
    if (autoScroll && loaded) { scrollToCurrent(); scrollRetry.current = setTimeout(scrollToCurrent, 150); }
  }, [autoScroll, loaded, scrollToCurrent]);
  useEffect(() => {
    if (skipGaps && playing && !loop && cue && currentTime >= cue.end && material.cues[index + 1]) void seek(material.cues[index + 1].start, true);
  }, [skipGaps, playing, loop, currentTime, index, seek, cue, material.cues]);
  const toggleSaved = useCallback(async (cueId: string) => {
    setActionError('');
    try { accept(await saveSpeakingMaterialState(material, scope, current => { const values = current.saved[material.id] ?? []; return { savedCueIds: values.includes(cueId) ? values.filter(value => value !== cueId) : [...values, cueId] }; })); }
    catch (failure) { setActionError(failure instanceof Error ? `收藏保存失败：${failure.message}` : '收藏保存失败，请重试'); }
  }, [accept, material, scope]);
  const finish = async () => {
    if (recordActive) { setActionError('请先停止录音或回放'); return; }
    pauseOriginal(); setSaving(true); setActionError('');
    try { const store = await session.save(); if (!store) { setActionError('请先播放原音或录音练习'); return; } accept(store); router.replace('/speaking/history'); }
    catch { setActionError('练习记录保存失败，请重试'); }
    finally { setSaving(false); }
  };
  const saveNote = async () => {
    if (!cue) return;
    setSaving(true); setActionError('');
    try { accept(await saveSpeakingMaterialState(material, scope, current => ({ notes: { ...current.notes[material.id], [cue.id]: note } }))); setSheet(null); }
    catch (failure) { setActionError(failure instanceof Error ? `笔记保存失败：${failure.message}` : '笔记保存失败，请重试'); }
    finally { setSaving(false); }
  };
  const lookup = useCallback((term: string) => { if (term.trim()) { setWord(term.trim()); setSheet('dictionary'); } }, []);
  const playCue = useCallback((id: string, start: number, reveal: boolean) => {
    if (reveal) setRevealed(current => new Set([...current, id]));
    void seek(start, true);
  }, [seek]);
  const openPage = (path: '/speaking/edit' | '/speaking/guide' | '/speaking/history') => {
    if (recordActive) { setActionError('请先停止录音或回放，再离开练习'); return; }
    pauseOriginal(); setSheet(null);
    if (path === '/speaking/edit') router.push({ pathname: path, params: { id: material.id } });
    else router.push(path);
  };
  const tool = (label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void, selected = false, toolbar = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} aria-pressed={selected} onPress={onPress} style={[styles.tool, toolbar && { minWidth: '25%', maxWidth: '25%' }, { backgroundColor: selected ? theme.accentSoft : theme.bg }]}><Ionicons name={icon} size={21} color={selected ? theme.accent : theme.textSecondary} /><Text style={{ color: selected ? theme.accent : theme.textMuted, fontSize: 10, marginTop: 5 }}>{label}</Text></Pressable>;
  const mediaProps = { source: source!, title: material.title, expanded, frameWidth: mediaWidth, ...(mediaBodyHeight > 0 ? { maxHeight: Math.max(140, mediaBodyHeight - (toolsExpanded ? 118 : 0)) } : {}), onController: playback.onController, onState: playback.onState };
  const engineKey = `${revision}:${source}`;
  const engine = material.mediaType === 'video' ? <ShadowingVideo key={engineKey} {...mediaProps} /> : <ShadowingAudio key={engineKey} {...mediaProps} />;
  const subtitleLabels = ['双语', '英文', '中文', '关闭'];
  const renderCue = useCallback(({ item }: { item: ShadowingBlock }) => <ShadowingCue key={item.id} item={item} selected={index >= item.index && index <= item.endIndex} hidden={masked && !revealed.has(item.id)} disabled={!loaded || recordActive} saved={saved.includes(item.id)} subtitles={subtitles} fontSize={fontSize} onPlay={playCue} onSave={toggleSaved} onLookup={lookup} />, [index, masked, revealed, loaded, recordActive, saved, subtitles, fontSize, playCue, toggleSaved, lookup]);
  const webRows = useMemo(() => Platform.OS === 'web' ? blocks.map(item => renderCue({ item })) : null, [blocks, renderCue]);
  const onTranscriptLayout = useCallback(() => { if (autoScroll && loaded) { clearTimeout(scrollRetry.current); scrollRetry.current = setTimeout(scrollToCurrent, 150); } }, [autoScroll, loaded, scrollToCurrent]);
  const emptyTranscript = <Text style={{ color: theme.textMuted, padding: 24 }}>{material.cues.length ? '没有匹配的字幕' : '还没有字幕，请展开工具后点「编辑」添加或校正。'}</Text>;
  return <View style={[styles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="影子跟读" />
    <View onLayout={measureWorkspace} style={[styles.workspace, { flexDirection: splitLayout ? 'row' : 'column', paddingHorizontal: splitLayout ? 24 : 16, paddingVertical: splitLayout ? 16 : 12, gap: splitLayout ? 28 : 16 }]}>
    <View style={[styles.mediaPane, splitLayout ? { flex: expanded ? 1.6 : 1.15 } : { height: workspaceHeight * .58 }]}>
    <View style={styles.paneHeading}>
      <Text numberOfLines={2} style={{ color: theme.text, fontSize: splitLayout ? 17 : 14, flex: 1, minWidth: 0 }}>{material.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={toolsExpanded ? '收起练习工具' : '展开练习工具'} accessibilityState={{ expanded: toolsExpanded }} aria-expanded={toolsExpanded} onPress={() => setToolsExpanded(value => !value)} style={[styles.toolsToggle, { borderColor: theme.border }]}>
        <Ionicons name="options-outline" size={16} color={theme.accent} /><Text style={{ color: theme.accent, fontSize: 12 }}>{toolsExpanded ? '收起工具' : '展开工具'}</Text><Ionicons name={toolsExpanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={14} color={theme.accent} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? '收起播放器' : '展开播放器'} onPress={() => setExpanded(value => !value)} style={styles.touch}><Ionicons name={expanded ? 'contract-outline' : 'expand-outline'} color={theme.accent} size={20} /></Pressable>
    </View>
    <ScrollView accessibilityLabel="播放器与练习工具" onLayout={measureMediaBody} style={styles.mediaBody} stickyHeaderIndices={[0]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    <View onLayout={measureMedia} style={{ backgroundColor: theme.bg, paddingBottom: 12 }}>{source !== null ? engine : null}</View>
    {mediaError || playback.error ? <View><Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{mediaError || playback.error}</Text><Pressable accessibilityRole="button" onPress={() => { resumeAt.current = livePlayback.current.time; resumed.current = false; setMediaError(''); setRevision(value => value + 1); }} style={styles.touch}><Text style={{ color: theme.accent }}>重试音视频</Text></Pressable></View> : null}
    {toolsExpanded ? <View style={styles.tools}>{tool('自动滚动', 'arrow-down-outline', () => setAutoScroll(!autoScroll), autoScroll, true)}{tool('已收藏句', 'star-outline', () => setSavedOnly(!savedOnly), savedOnly, true)}{tool('自动分段', 'list-outline', () => setSegmented(!segmented), segmented, true)}{tool('讲解', 'help-circle-outline', () => setSheet('explain'), false, true)}{tool('词汇', 'copy-outline', () => { setWord(''); setSheet('words'); }, false, true)}{tool('编辑', 'create-outline', () => openPage('/speaking/edit'), false, true)}{tool('查找', 'search-outline', () => { setSearching(!searching); setQuery(''); }, searching, true)}{tool('更多', 'ellipsis-horizontal', () => setSheet('more'), false, true)}</View> : null}
    </ScrollView>
    </View>
    <View style={[styles.transcriptPane, { borderLeftWidth: splitLayout ? .5 : 0, borderTopWidth: splitLayout ? 0 : .5, borderColor: theme.border, paddingLeft: splitLayout ? 24 : 0 }]}>
    <View style={[styles.transcriptHeading, { borderBottomColor: theme.border }]}>
      <View style={styles.paneHeading}><Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18, flex: 1 }}>跟读字幕</Text><Pressable accessibilityRole="button" accessibilityLabel="定位当前字幕" disabled={selectedBlock < 0} onPress={() => { clearTimeout(scrollRetry.current); scrollAttempts.current = 0; if (Platform.OS !== 'web') setSubtitleRevision(value => value + 1); scrollToCurrent(); scrollRetry.current = setTimeout(scrollToCurrent, 150); }} style={styles.currentCue}><Ionicons name="locate-outline" size={16} color={theme.accent} /><Text style={{ color: theme.accent, fontSize: 12 }}>当前句</Text></Pressable></View>
      <Text style={{ color: theme.textMuted, fontSize: 11 }}>{speakingAccentLabel(material)} · {material.cues.length} 句字幕 · {formatSpeakingTime(playback.duration || material.duration)} · {speakingSourceLabel(material)}{cue ? ` · 第 ${playback.index + 1} 句` : ''}</Text>
    </View>
    {searching ? <TextInput accessibilityLabel="查找字幕" placeholder="搜索英文或中文" placeholderTextColor={theme.textMuted} value={query} onChangeText={setQuery} style={[speakingStyles.input, { borderColor: theme.border, color: theme.text }]} /> : null}
    {Platform.OS === 'web' ? <ScrollView ref={webTranscript} accessibilityLabel="跟读字幕列表" tabIndex={0} style={styles.transcriptList} onLayout={onTranscriptLayout} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: 24, width: '100%' }}>{blocks.length ? webRows : emptyTranscript}</ScrollView> : <FlatList key={`${splitLayout}:${subtitleAnchor ?? 'start'}:${subtitleRevision}:${segmented}:${savedOnly}:${query.trim()}`} ref={list} accessibilityLabel="跟读字幕列表" tabIndex={0} style={styles.transcriptList} onLayout={onTranscriptLayout} initialScrollIndex={Math.max(0, selectedBlock)} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} showsVerticalScrollIndicator data={blocks} keyExtractor={item => item.id} ListEmptyComponent={emptyTranscript} onScrollToIndexFailed={({ averageItemLength, highestMeasuredFrameIndex, index }) => {
      // 长影片远距离跳转时只重建字幕列表，避免逐段测量，同时保持播放器挂载。
      const target = blocks[index];
      if (target && index > highestMeasuredFrameIndex + 32 && target.id !== subtitleAnchor) {
        clearTimeout(scrollRetry.current); scrollAttempts.current = 0; setSubtitleAnchor(target.id); return;
      }
      list.current?.scrollToOffset({ offset: Math.max(0, averageItemLength * index), animated: false });
      clearTimeout(scrollRetry.current);
      if (scrollAttempts.current++ < 3) scrollRetry.current = setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: splitLayout ? .3 : 0, animated: true }), 150);
    }} renderItem={renderCue} contentContainerStyle={{ paddingBottom: 24, width: '100%' }} />}
    </View>
    </View>
    <View style={[styles.footer, { backgroundColor: theme.bg, borderTopColor: theme.border, paddingBottom: Math.max(8, insets.bottom) }]}><View style={styles.footerInner}><View style={styles.controls}>
      {tool(recordActive ? '录音／回放中' : '录音', 'mic-outline', () => { if (!recordActive) setRecordPanel(!recordPanel); }, recordPanel)}{tool('上一句', 'play-skip-back-outline', () => { if (!recordActive) void playback.seek(material.cues[Math.max(0, playback.index - 1)]?.start ?? 0, true); })}<Pressable accessibilityRole="button" accessibilityLabel={playback.playing || playback.waiting ? '暂停原音' : '播放原音'} disabled={!playback.loaded || recordActive} accessibilityState={{ disabled: !playback.loaded || recordActive }} onPress={() => void playback.toggle()} style={[styles.play, { backgroundColor: theme.accent, opacity: playback.loaded && !recordActive ? 1 : .45 }]}><Ionicons name={playback.playing || playback.waiting ? 'pause' : 'play'} size={28} color={theme.accentText} /></Pressable>{tool('下一句', 'play-skip-forward-outline', () => { if (!recordActive) void playback.seek(material.cues[Math.min(material.cues.length - 1, playback.index + 1)]?.start ?? 0, true); })}{tool('设置', 'settings-outline', () => setSettings(true))}
    </View><ShadowingProgress time={playback.currentTime} duration={playback.duration} enabled={playback.loaded && !recordActive} seek={time => void playback.seek(time)} />
    <View style={styles.controls}>{tool('逐句复读', 'repeat-outline', () => { if (cue && !recordActive && playback.loaded) playback.startLoop(playback.loop?.kind === 'sentence' ? null : { kind: 'sentence', start: cue.start, end: cue.end }); }, playback.loop?.kind === 'sentence')}{tool(abStart !== null ? '设置 B 点' : 'AB 复读', 'swap-horizontal-outline', () => {
      if (!playback.loaded || recordActive) return;
      if (playback.loop?.kind === 'ab') { playback.startLoop(null); setAbStart(null); setActionError(''); return; }
      if (abStart === null) { setAbStart(playback.currentTime); setActionError(''); }
      else if (playback.currentTime <= abStart + .1) setActionError('B 点需要晚于 A 点，请继续播放后设置');
      else { playback.startLoop({ kind: 'ab', start: abStart, end: playback.currentTime }); setAbStart(null); setActionError(''); }
    }, playback.loop?.kind === 'ab' || abStart !== null)}{tool(`字幕·${subtitleLabels[subtitles]}`, 'text-outline', () => setSubtitles((subtitles + 1) % 4))}{tool('遮挡板', 'eye-off-outline', () => { setMasked(!masked); setRevealed(new Set()); }, masked)}{tool(`${playback.rate}×`, 'speedometer-outline', () => setSettings(true))}</View>
    {playback.waiting ? <Text style={{ color: theme.accent, fontSize: 10, textAlign: 'center' }}>留一点停顿，跟着说。</Text> : null}{actionError ? <Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{actionError}</Text> : null}
    {session.error ? <View><Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{session.error}</Text><Pressable accessibilityRole="button" disabled={saving} onPress={() => { setSaving(true); void session.save().then(store => { if (store) accept(store); }).catch(() => undefined).finally(() => setSaving(false)); }} style={styles.touch}><Text style={{ color: theme.accent }}>重试保存练习</Text></Pressable></View> : null}
    <View style={{ display: recordPanel ? 'flex' : 'none' }}><ShadowingRecording materialId={material.id} material={material} cueId={cue?.id ?? ''} scope={scope} saved={library.store.recordings[material.id]} pauseOriginal={pauseOriginal} onActive={onRecordingActive} onSaved={accept} /></View>
    </View></View>
    <ShadowingSettings visible={settings} close={() => setSettings(false)} rate={playback.rate} changeRate={playback.changeRate} repeatCount={playback.repeatCount} setRepeatCount={playback.setRepeatCount} gap={playback.gap} setGap={playback.setGap} fontSize={fontSize} setFontSize={setFontSize} skipGaps={skipGaps} setSkipGaps={setSkipGaps} />
    <Modal visible={sheet !== null} transparent animationType="fade" onRequestClose={() => setSheet(null)}><Pressable onPress={() => setSheet(null)} style={styles.backdrop}><Pressable onPress={event => event.stopPropagation()} style={[styles.sheet, { backgroundColor: theme.bg }]}><ScrollView keyboardShouldPersistTaps="handled"><Text accessibilityRole="header" style={{ color: theme.text, fontSize: 23, marginBottom: 20 }}>{sheet === 'notes' ? '台词笔记' : sheet === 'explain' ? '当前句讲解' : sheet === 'words' ? '素材词汇' : sheet === 'dictionary' ? '字幕查词' : '更多练习工具'}</Text>
      {sheet === 'notes' ? <><Text style={{ color: theme.text, fontSize: 16, lineHeight: 25, marginBottom: 14 }}>{cue?.en}</Text><TextInput multiline accessibilityLabel="当前句笔记" value={note} onChangeText={setNote} style={[speakingStyles.input, { color: theme.text, borderColor: theme.border, minHeight: 120, textAlignVertical: 'top' }]} /><Pressable disabled={saving} accessibilityRole="button" onPress={() => void saveNote()} style={styles.sheetAction}><Text style={{ color: theme.accent }}>{saving ? '正在保存…' : '保存笔记'}</Text></Pressable></> : null}
      {sheet === 'explain' ? <><Text style={{ color: theme.text, fontFamily: fonts.reading, fontSize: 20, lineHeight: 30 }}>{cue?.en}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted, marginVertical: 15 }]}>{cue?.zh}</Text>{material.id === 'curiosity' && curiosityNotes[playback.index] ? <><Text style={{ color: theme.accent, fontSize: 17 }}>{curiosityNotes[playback.index].phrase}</Text><Text style={[speakingStyles.hint, { color: theme.textSecondary, marginVertical: 12 }]}>{curiosityNotes[playback.index].text}</Text><Text style={{ color: theme.text, fontSize: 15, lineHeight: 25 }}>{curiosityNotes[playback.index].rhythm}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 20 }]}>素材配套讲解，非 AI 生成。AI 台词讲解服务尚未开放。</Text></> : <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>这段素材暂未提供配套讲解，AI 台词讲解服务尚未开放。</Text>}</> : null}
      {sheet === 'words' ? <><TextInput accessibilityLabel="词典查询" placeholder="输入英文单词" placeholderTextColor={theme.textMuted} value={word} onChangeText={setWord} onSubmitEditing={() => lookup(word)} autoCapitalize="none" style={[speakingStyles.input, { color: theme.text, borderColor: theme.border }]} /><Pressable accessibilityRole="button" disabled={!word.trim()} onPress={() => lookup(word)} style={styles.sheetAction}><Text style={{ color: theme.accent }}>查词</Text></Pressable>{material.origin === 'platform' ? speakingVocabulary.filter(item => material.cues.some(line => new RegExp(`\\b${item.word}\\b`, 'i').test(line.en))).map(item => <Pressable accessibilityRole="button" accessibilityLabel={`查词 ${item.word}`} onPress={() => lookup(item.word)} key={item.word} style={{ paddingVertical: 16, borderBottomColor: theme.border, borderBottomWidth: .5 }}><Text style={{ color: theme.text, fontSize: 19 }}>{item.word}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{item.meaning}</Text></Pressable>) : null}<Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 20 }]}>点按英文字幕中的单词，也可以直接查询离线词典。</Text></> : null}
      {sheet === 'dictionary' ? <ShadowingDictionary key={word} term={word} /> : null}
      {sheet === 'more' ? <>{[['台词笔记', () => { setNote(library.store.notes[material.id]?.[cue?.id ?? ''] ?? ''); setSheet('notes'); }], ['练习设置', () => { setSheet(null); setSettings(true); }], ['跟读指南', () => openPage('/speaking/guide')], ['跟读记录', () => openPage('/speaking/history')], [saving ? '正在保存…' : '完成本次跟读', () => void finish()]].map(([label, action]) => <Pressable key={String(label)} accessibilityRole="button" disabled={saving} onPress={action as () => void} style={styles.sheetAction}><Text style={{ color: theme.accent }}>{label as string}</Text></Pressable>)}</> : null}
      {actionError ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{actionError}</Text> : null}<Pressable accessibilityRole="button" onPress={() => setSheet(null)} style={styles.sheetAction}><Text style={{ color: theme.textMuted }}>关闭</Text></Pressable>
    </ScrollView></Pressable></Pressable></Modal>
  </View>;
}
const styles = StyleSheet.create({
  workspace: { flex: 1, minHeight: 0, width: '100%', maxWidth: 1440, alignSelf: 'center' }, mediaPane: { minWidth: 0, minHeight: 0, gap: 12 }, mediaBody: { flex: 1, minHeight: 0 }, paneHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }, transcriptPane: { flex: 1, minWidth: 0, minHeight: 0 }, transcriptHeading: { paddingBottom: 12, borderBottomWidth: .5 }, transcriptList: { flex: 1, minHeight: 0 }, currentCue: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }, toolsToggle: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: .5, borderRadius: 4 },
  page: { flex: 1 }, touch: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }, tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 }, tool: { flex: 1, minWidth: 0, minHeight: 53, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }, cue: { paddingHorizontal: 22, paddingBottom: 20, borderBottomWidth: .5, borderLeftWidth: 2 },
  footer: { borderTopWidth: .5, paddingHorizontal: 14, paddingTop: 7 }, footerInner: { maxWidth: 920, width: '100%', alignSelf: 'center' }, controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }, play: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginHorizontal: 5 }, progressRow: { flexDirection: 'row', gap: 10, alignItems: 'center' }, progress: { flex: 1, minHeight: 28, justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', alignItems: 'center', padding: 20 }, sheet: { padding: 24, width: '100%', maxWidth: 520, maxHeight: '85%', borderRadius: 4 }, sheetAction: { minHeight: 50, justifyContent: 'center' },
});
