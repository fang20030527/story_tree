import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation, type NativeStackNavigationOptions } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type LayoutChangeEvent, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, weight } from '@/constants/theme';
import { FadeOnChange, animateNextLayout, useReducedMotion } from '@/components/motion';
import { ListRow, Meta, SheetFrame, TextAction, ToggleText } from '@/components/subpage';
import { useAppTheme } from '@/context/ThemeContext';
import { useEditorialAudio } from '@/features/editorial/EditorialAudioProvider';
import { curiosityNotes, speakingVocabulary } from './annotations';
import { speakingSourceLabel } from './catalog';
import { speakingAccentLabel } from './accents';
import { resolveSpeakingMedia } from './mediaStorage';
import { formatSpeakingTime, type SpeakingMaterial } from './model';
import { updateSpeakingStore } from './speakingStorage';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { useSpeakingSession } from './useSpeakingSession';
import { SpeakingHeader, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { speakingTitleText } from './titles';
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
import { observeRenderedSubtitles, scrollToRenderedSubtitle } from './subtitleScrolling';
import { SpeakingTranscriptExport } from './SpeakingTranscriptExport';
import { useShadowingTranslations } from './useShadowingTranslations';
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
  const reducedMotion = useReducedMotion();
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
  const [source, setSource] = useState<string | number | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // 矮屏（如 iPhone SE）默认收起工具行，把空间留给字幕。
  const [toolsExpanded, setToolsExpanded] = useState(() => height >= 720);
  const [autoScroll, setAutoScroll] = useState(true);
  const [segmented, setSegmented] = useState(true);
  const [savedOnly, setSavedOnly] = useState(false);
  const [subtitles, setSubtitles] = useState(0);
  const [videoSubtitles, setVideoSubtitles] = useState(true);
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
  // 拖动进度条期间暂停字幕/工具区滚动和返回手势，避免同一次横向拖动被判定为滚动或侧滑返回。
  const [seeking, setSeeking] = useState(false);
  // 收藏点按后立即显示目标状态，云端写入（会排在练习记录同步之后）完成或失败后再以存储为准。
  const [pendingSaves, setPendingSaves] = useState<Record<string, boolean>>({});
  const saveTokens = useRef(new Map<string, number>());
  const navigation = useNavigation<{ setOptions: (options: Partial<NativeStackNavigationOptions>) => void }>();
  const list = useRef<FlatList>(null);
  const webTranscript = useRef<ScrollView>(null);
  const scrollRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollAttempts = useRef(0);
  useEffect(() => () => clearTimeout(scrollRetry.current), []);
  const translations = useShadowingTranslations(material, scope, playback.index, subtitles === 0 || subtitles === 2 || (material.mediaType === 'video' && videoSubtitles));
  const cues = translations.cues;
  const cue = cues[playback.index];
  const saved = library.store.saved[material.id] ?? emptySavedCues;
  usePreventRemove(recordActive, () => setActionError('请先停止录音或回放，再离开练习'));
  // iOS 26 起原生栈默认开启“全屏侧滑返回”，横向拖动进度条、工具行都会被当成返回手势并取消 JS 触摸。
  // 本页只保留屏幕左边缘返回；拖动进度条期间连边缘返回也暂时关闭。
  useEffect(() => { navigation.setOptions({ fullScreenGestureEnabled: false, gestureEnabled: !seeking }); }, [navigation, seeking]);
  const session = useSpeakingSession(material, scope, playback.playing || recordActive, playback.currentTime, playback.index);
  const onRecordingActive = useCallback((active: boolean) => setRecordActive(active), []);
  const accept = library.accept;
  const pauseOriginal = playback.pause;
  const resumed = useRef(false);
  const resumeAt = useRef<number | null>(null);
  const resumePlaying = useRef(false);
  const livePlayback = useRef({ time: playback.currentTime, playing: playback.playing });
  // 出错瞬间的状态（playing 已变 false）不覆盖，续链后才能回到出错前的位置并继续播放。
  useEffect(() => { if (loaded && !playback.playerError) livePlayback.current = { time: playback.currentTime, playing: playback.playing }; }, [loaded, playback.currentTime, playback.playing, playback.playerError]);
  useEffect(() => { closeEditorialAudio(); }, [closeEditorialAudio]);
  const cloudMedia = Boolean(material.assetId || (material.origin === 'platform' && material.mediaType === 'video'));
  // 自动续链只换 URL、不额外重建播放器：不放进 engineKey，新链接到达后 source 变化才会重建一次。
  const [linkRevision, setLinkRevision] = useState(0);
  const linkExpiresAt = useRef(0);
  const autoRefreshBudget = useRef(1);
  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    if (cloudMedia) {
      // 不再按定时器在播放中途销毁/重建播放器（缓冲中销毁 AVPlayer 有崩溃风险）；
      // 签名链接有效期 1 小时，只有播放器报错或加载超时且链接已过期时才续签。
      void (async () => {
        const media = material.origin === 'platform'
          ? await getSpeakingCatalogPlayback(material.id) : await getSpeakingPlayback(material.assetId!);
        if (!active) return;
        const expiresAt = Date.parse(media.expiresAt);
        linkExpiresAt.current = Number.isFinite(expiresAt) ? expiresAt : 0;
        reportMediaState(initialShadowingState);
        setSource(media.url); setMediaError('');
      })().catch((failure) => { if (active) setMediaError(failure instanceof Error ? failure.message : '云端音视频读取失败，请重试'); });
    } else if (material.mediaId) void resolveSpeakingMedia(material.mediaId).then(media => {
      if (!active) { media.release(); return; } release = media.release; setSource(media.uri); setMediaError('');
    }).catch(() => { if (active) setMediaError('音视频读取失败，请重试或重新导入文件'); });
    return () => { active = false; release?.(); };
  }, [cloudMedia, material.mediaId, material.assetId, material.id, material.origin, revision, linkRevision, reportMediaState]);
  const linkExpired = useCallback(() => Date.now() >= linkExpiresAt.current - 60_000, []);
  // 链接已过期时总是允许续签（新链接 1 小时内不会再过期，不会循环）；
  // 未过期的播放器错误只自动重试一次，之后交给“重试音视频”按钮，避免坏文件反复重建播放器。
  const refreshCloudLink = useCallback(() => {
    const expired = linkExpired();
    if (!expired && autoRefreshBudget.current <= 0) return false;
    if (!expired) autoRefreshBudget.current -= 1;
    resumeAt.current = livePlayback.current.time; resumePlaying.current = livePlayback.current.playing; resumed.current = false;
    setMediaError(''); setLinkRevision(value => value + 1);
    return true;
  }, [linkExpired]);
  const playerError = playback.playerError;
  useEffect(() => {
    if (cloudMedia && source !== null && playerError) refreshCloudLink();
  }, [cloudMedia, source, playerError, refreshCloudLink]);
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
    const timeout = setTimeout(() => {
      // 过期链接上的 AVPlayer 可能一直卡在加载而不报错：此时续签而不是直接报超时。
      if (cloudMedia && linkExpired() && refreshCloudLink()) return;
      setMediaError('音视频加载超时，请重试');
    }, 15000);
    return () => clearTimeout(timeout);
  }, [source, loaded, revision, cloudMedia, linkExpired, refreshCloudLink]);
  const allBlocks = useMemo(() => material.cues.flatMap((item, index, all) => {
    if (!segmented && index % 2 === 1) return [];
    const tail = !segmented ? all[index + 1] : undefined;
    return [{ ...item, index, endIndex: tail ? index + 1 : index, en: tail ? `${item.en} ${tail.en}` : item.en, zh: tail ? [item.zh, tail.zh].filter(value => value.trim()).join(' ') : item.zh, end: tail?.end ?? item.end }];
  }), [material.cues, segmented]);
  // 中文完成时保留其他字幕块的引用，长影片只重绘拿到译文的句子。
  const blocks = useMemo(() => allBlocks.filter(item => (!savedOnly || cues.slice(item.index, item.endIndex + 1).some(line => saved.includes(line.id))) && (!query.trim() || `${item.en} ${cues.slice(item.index, item.endIndex + 1).map(line => line.zh).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))), [allBlocks, cues, savedOnly, saved, query]);
  const visibleBlocks = useRef(blocks);
  useEffect(() => { visibleBlocks.current = blocks; }, [blocks]);
  const showVisibleIndexes = translations.showVisibleIndexes;
  const reportVisibleBlocks = useCallback((indexes: number[]) => showVisibleIndexes(indexes.flatMap(index => {
    const block = visibleBlocks.current.find(item => item.index === index);
    return block ? Array.from({ length: block.endIndex - block.index + 1 }, (_, offset) => block.index + offset) : [];
  })), [showVisibleIndexes]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<ShadowingBlock>[] }) => reportVisibleBlocks(viewableItems.map(item => item.item.index)), [reportVisibleBlocks]);
  const visibleBlockKey = useMemo(() => blocks.map(item => `${item.index}:${item.endIndex}`).join(','), [blocks]);
  useEffect(() => {
    if (webTranscript.current) return observeRenderedSubtitles(webTranscript.current, reportVisibleBlocks);
  }, [visibleBlockKey, reportVisibleBlocks]);
  useEffect(() => {
    if (Platform.OS === 'web') webTranscript.current?.scrollTo({ y: 0, animated: false });
  }, [query, segmented, savedOnly]);
  const selectedBlock = blocks.findIndex(item => playback.index >= item.index && playback.index <= item.endIndex);
  // 只依赖当前句的位置：收藏、取消收藏会生成新的 blocks，但不应把列表拉回当前播放句。
  const selectedCueIndex = blocks[selectedBlock]?.index ?? -1;
  const scrollToCurrent = useCallback(() => {
    clearTimeout(scrollRetry.current); scrollAttempts.current = 0;
    if (selectedBlock < 0) return;
    if (Platform.OS === 'web') {
      if (webTranscript.current) scrollToRenderedSubtitle(webTranscript.current, `shadowing-cue-${selectedCueIndex}`, splitLayout ? .3 : 0);
    } else list.current?.scrollToIndex({ index: selectedBlock, viewPosition: splitLayout ? .3 : 0, animated: true });
  }, [selectedBlock, selectedCueIndex, splitLayout]);
  useEffect(() => {
    if (autoScroll && loaded) { scrollToCurrent(); scrollRetry.current = setTimeout(scrollToCurrent, 150); }
  }, [autoScroll, loaded, scrollToCurrent]);
  useEffect(() => {
    if (skipGaps && playing && !loop && cue && currentTime >= cue.end && material.cues[index + 1]) void seek(material.cues[index + 1].start, true);
  }, [skipGaps, playing, loop, currentTime, index, seek, cue, material.cues]);
  const setCueSaved = useCallback(async (cueId: string, desired: boolean) => {
    setActionError('');
    const token = (saveTokens.current.get(cueId) ?? 0) + 1;
    saveTokens.current.set(cueId, token);
    setPendingSaves(current => ({ ...current, [cueId]: desired }));
    try {
      accept(await saveSpeakingMaterialState(material, scope, current => {
        const values = current.saved[material.id] ?? [];
        return { savedCueIds: desired ? values.includes(cueId) ? values : [...values, cueId] : values.filter(value => value !== cueId) };
      }));
    } catch (failure) { setActionError(failure instanceof Error ? `收藏保存失败：${failure.message}` : '收藏保存失败，请重试'); }
    finally {
      // 只有最后一次点按结束时才撤掉临时状态，期间的旧结果不会让图标来回跳。
      if (saveTokens.current.get(cueId) === token) setPendingSaves(current => { const next = { ...current }; delete next[cueId]; return next; });
    }
  }, [accept, material, scope]);
  const isSaved = useCallback((cueId: string) => pendingSaves[cueId] ?? saved.includes(cueId), [pendingSaves, saved]);
  // 合并分段时一个字幕块以首句编号收藏，与列表中的收藏按钮保持一致。
  const currentSaveId = segmented ? cue?.id : material.cues[playback.index - (playback.index % 2)]?.id;
  const currentSaved = currentSaveId ? isSaved(currentSaveId) : false;
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
  const tool = (label: string, onPress: () => void, selected = false) => <ToggleText key={label} label={label} active={selected} onPress={onPress} />;
  const enterFullscreen = () => {
    const enter = playback.controller.current?.enterFullscreen;
    if (!enter) { setActionError('视频尚未就绪，请稍后再试'); return; }
    setActionError('');
    // 全屏请求必须直接来自点按，避免浏览器丢失用户激活状态。
    void enter().catch(() => setActionError('无法进入全屏，请重试'));
  };
  const mediaProps = { source: source!, title: material.title, expanded, frameWidth: mediaWidth, ...(mediaBodyHeight > 0 ? { maxHeight: Math.max(140, mediaBodyHeight - (toolsExpanded ? 60 : 0)) } : {}), onController: playback.onController, onState: playback.onState };
  // 播放区按“标题 + 媒体 + 工具行”的实际高度分配，剩余空间留给字幕；展开播放器时沿用原比例。
  const mediaContentHeight = material.mediaType === 'video'
    ? Math.min(Math.max(170, (mediaWidth || width - 32) * 9 / 16), Math.max(170, height * .42))
    : 146;
  const mediaPaneHeight = expanded ? workspaceHeight * .58 : Math.min(workspaceHeight * .58, 44 + 8 + mediaContentHeight + 12 + (toolsExpanded ? 52 : 0) + 4);
  const engineKey = `${revision}:${source}`;
  const videoCue = videoSubtitles && loaded && !playback.playerError && cue && currentTime >= cue.start && currentTime < cue.end ? cue : null;
  const engine = material.mediaType === 'video' ? <ShadowingVideo key={engineKey} {...mediaProps} subtitleCue={videoCue} /> : <ShadowingAudio key={engineKey} {...mediaProps} />;
  const subtitleLabels = ['双语', '英文', '中文', '隐藏'];
  const renderCue = useCallback(({ item }: { item: ShadowingBlock }) => {
    const lines = cues.slice(item.index, item.endIndex + 1);
    const missing = lines.filter(line => !line.zh.trim());
    const translatedTextZh = lines.map(line => line.zh).filter(value => value.trim()).join(' ');
    const status = (value: 'loading' | 'error') => missing.some(line => translations.states[line.id]?.sourceText === line.en && translations.states[line.id]?.status === value);
    const translationStatus = material.origin !== 'file' ? undefined : status('error') ? 'error' : status('loading') ? 'loading' : missing.length ? 'waiting' : undefined;
    return <ShadowingCue key={item.id} item={item} selected={index >= item.index && index <= item.endIndex} hidden={masked && !revealed.has(item.id)} disabled={!loaded || recordActive} saved={isSaved(item.id)} subtitles={subtitles} fontSize={fontSize} translatedTextZh={translatedTextZh} translationStatus={translationStatus} onRetryTranslation={translations.retry} onPlay={playCue} onSave={setCueSaved} onLookup={lookup} />;
  }, [index, masked, revealed, loaded, recordActive, isSaved, subtitles, fontSize, playCue, setCueSaved, lookup, cues, translations.states, translations.retry, material.origin]);
  const webRows = useMemo(() => Platform.OS === 'web' ? blocks.map(item => renderCue({ item })) : null, [blocks, renderCue]);
  const onTranscriptLayout = useCallback(() => { if (autoScroll && loaded) { clearTimeout(scrollRetry.current); scrollRetry.current = setTimeout(scrollToCurrent, 150); } }, [autoScroll, loaded, scrollToCurrent]);
  const emptyTranscript = <Text style={{ color: theme.textMuted, padding: 24 }}>{material.cues.length ? '没有匹配的台词' : '还没有台词，请展开工具后点「编辑」添加或校正。'}</Text>;
  return <View style={[styles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="影子跟读" />
    <View onLayout={measureWorkspace} style={[styles.workspace, { flexDirection: splitLayout ? 'row' : 'column', paddingHorizontal: splitLayout ? 24 : 16, paddingVertical: splitLayout ? 16 : 12, gap: splitLayout ? 28 : 16 }]}>
    <View style={[styles.mediaPane, splitLayout ? { flex: expanded ? 1.6 : 1.15 } : { height: mediaPaneHeight }]}>
    <View style={styles.paneHeading}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={splitLayout ? 2 : 1} style={[styles.materialTitle, { color: theme.text, fontSize: splitLayout ? 18 : 15 }]}>{speakingTitleText(material.title)}</Text>
      </View>
      <TextAction label={toolsExpanded ? '收起工具' : '工具'} accessibilityLabel={toolsExpanded ? '收起练习工具' : '展开练习工具'} tone="muted" onPress={() => { animateNextLayout(reducedMotion); setToolsExpanded(value => !value); }} />
      <Pressable accessibilityRole="button" accessibilityLabel={material.mediaType === 'video' ? '全屏播放' : expanded ? '收起播放器' : '展开播放器'} disabled={material.mediaType === 'video' && (!loaded || recordActive)} onPress={material.mediaType === 'video' ? enterFullscreen : () => setExpanded(value => !value)} style={[styles.touch, { opacity: material.mediaType === 'video' && (!loaded || recordActive) ? .4 : 1 }]}><Ionicons name={expanded ? 'contract-outline' : 'expand-outline'} color={theme.textSecondary} size={19} /></Pressable>
    </View>
    <ScrollView accessibilityLabel="播放器与练习工具" scrollEnabled={!seeking} onLayout={measureMediaBody} style={styles.mediaBody} stickyHeaderIndices={[0]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    <View onLayout={measureMedia} style={{ backgroundColor: theme.bg, paddingBottom: 12 }}>{source !== null ? engine : null}</View>
    {mediaError || playback.error ? <View><Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{mediaError || playback.error}</Text><Pressable accessibilityRole="button" onPress={() => { resumeAt.current = livePlayback.current.time; resumed.current = false; autoRefreshBudget.current = 1; setMediaError(''); setRevision(value => value + 1); }} style={styles.touch}><Text style={{ color: theme.accent }}>重试音视频</Text></Pressable></View> : null}
    {toolsExpanded ? <ScrollView horizontal scrollEnabled={!seeking} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>{tool('自动滚动', () => setAutoScroll(!autoScroll), autoScroll)}{tool('自动分段', () => setSegmented(!segmented), segmented)}{tool('已收藏句', () => setSavedOnly(!savedOnly), savedOnly)}{tool('查找', () => { setSearching(!searching); setQuery(''); }, searching)}<View style={[styles.toolDivider, { backgroundColor: theme.border }]} />{tool('讲解', () => setSheet('explain'))}{tool('词汇', () => { setWord(''); setSheet('words'); })}{tool('编辑', () => openPage('/speaking/edit'))}{tool('更多', () => setSheet('more'))}</ScrollView> : null}
    </ScrollView>
    </View>
    <View style={[styles.transcriptPane, { borderLeftWidth: splitLayout ? .5 : 0, borderTopWidth: splitLayout ? 0 : .5, borderColor: theme.border, paddingLeft: splitLayout ? 24 : 0 }]}>
    <View style={[styles.transcriptHeading, { borderBottomColor: theme.text }]}>
      <View style={styles.paneHeading}><Text accessibilityRole="header" style={[styles.transcriptTitle, { color: theme.text }]}>台词</Text><TextAction label="当前句" accessibilityLabel="定位当前台词" disabled={selectedBlock < 0} onPress={() => { clearTimeout(scrollRetry.current); scrollAttempts.current = 0; if (Platform.OS !== 'web') setSubtitleRevision(value => value + 1); scrollToCurrent(); scrollRetry.current = setTimeout(scrollToCurrent, 150); }} /></View>
      <Meta>{speakingAccentLabel(material)} · {material.cues.length} 句 · {formatSpeakingTime(playback.duration || material.duration)} · {speakingSourceLabel(material)}{cue ? ` · 第 ${playback.index + 1} 句` : ''}</Meta>
    </View>
    {searching ? <TextInput accessibilityLabel="查找台词" placeholder="搜索英文或中文" placeholderTextColor={theme.textMuted} value={query} onChangeText={setQuery} style={[speakingStyles.input, styles.search, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surfaceAlt }]} /> : null}
    {Platform.OS === 'web' ? <ScrollView ref={webTranscript} accessibilityLabel="跟读台词列表" tabIndex={0} scrollEnabled={!seeking} style={styles.transcriptList} onLayout={onTranscriptLayout} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: 24, width: '100%' }}>{blocks.length ? webRows : emptyTranscript}</ScrollView> : <FlatList key={`${splitLayout}:${subtitleAnchor ?? 'start'}:${subtitleRevision}:${segmented}:${savedOnly}:${query.trim()}`} ref={list} accessibilityLabel="跟读台词列表" tabIndex={0} scrollEnabled={!seeking} style={styles.transcriptList} onLayout={onTranscriptLayout} onViewableItemsChanged={onViewableItemsChanged} initialScrollIndex={Math.max(0, selectedBlock)} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} showsVerticalScrollIndicator data={blocks} keyExtractor={item => item.id} ListEmptyComponent={emptyTranscript} onScrollToIndexFailed={({ averageItemLength, highestMeasuredFrameIndex, index }) => {
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
    <View style={[styles.footer, { backgroundColor: theme.bg, borderTopColor: theme.border, paddingBottom: Math.max(8, insets.bottom) }]}><View style={styles.footerInner}>
    <ShadowingProgress time={playback.currentTime} duration={playback.duration} enabled={playback.loaded && !recordActive} seek={time => void playback.seek(time)} onDragChange={setSeeking} />
    <View style={styles.transport}>
      <TextAction label={recordActive ? '录音中' : '录音'} accessibilityLabel={recordActive ? '录音／回放中' : '录音'} tone={recordPanel ? 'accent' : 'muted'} onPress={() => { if (!recordActive) { animateNextLayout(reducedMotion); setRecordPanel(!recordPanel); } }} style={styles.transportSide} />
      <View style={styles.transportCenter}>
        <Pressable accessibilityRole="button" accessibilityLabel="上一句" onPress={() => { if (!recordActive) void playback.seek(material.cues[Math.max(0, playback.index - 1)]?.start ?? 0, true); }} style={styles.touch}><Ionicons name="play-skip-back" size={22} color={theme.text} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={playback.playing || playback.waiting ? '暂停原音' : '播放原音'} disabled={!playback.loaded || recordActive} accessibilityState={{ disabled: !playback.loaded || recordActive }} onPress={() => void playback.toggle()} style={({ pressed }) => [styles.play, { backgroundColor: theme.accent, opacity: playback.loaded && !recordActive ? pressed ? .82 : 1 : .4, transform: [{ scale: pressed && !reducedMotion ? .96 : 1 }] }]}><Ionicons name={playback.playing || playback.waiting ? 'pause' : 'play'} size={26} color={theme.accentText} style={playback.playing || playback.waiting ? undefined : { marginLeft: 3 }} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="下一句" onPress={() => { if (!recordActive) void playback.seek(material.cues[Math.min(material.cues.length - 1, playback.index + 1)]?.start ?? 0, true); }} style={styles.touch}><Ionicons name="play-skip-forward" size={22} color={theme.text} /></Pressable>
      </View>
      <TextAction label="设置" tone="muted" onPress={() => setSettings(true)} style={[styles.transportSide, { alignItems: 'flex-end' }]} />
    </View>
    <ScrollView horizontal scrollEnabled={!seeking} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modes}>{tool('逐句复读', () => { if (cue && !recordActive && playback.loaded) playback.startLoop(playback.loop?.kind === 'sentence' ? null : { kind: 'sentence', start: cue.start, end: cue.end }); }, playback.loop?.kind === 'sentence')}{tool(abStart !== null ? '设置 B 点' : 'AB 复读', () => {
      if (!playback.loaded || recordActive) return;
      if (playback.loop?.kind === 'ab') { playback.startLoop(null); setAbStart(null); setActionError(''); return; }
      if (abStart === null) { setAbStart(playback.currentTime); setActionError(''); }
      else if (playback.currentTime <= abStart + .1) setActionError('B 点需要晚于 A 点，请继续播放后设置');
      else { playback.startLoop({ kind: 'ab', start: abStart, end: playback.currentTime }); setAbStart(null); setActionError(''); }
    }, playback.loop?.kind === 'ab' || abStart !== null)}<ToggleText key="收藏本句" label="收藏本句" accessibilityLabel={currentSaved ? '取消收藏当前句' : '收藏当前句'} active={currentSaved} disabled={!currentSaveId} onPress={() => { if (currentSaveId) void setCueSaved(currentSaveId, !currentSaved); }} />{material.mediaType === 'video' ? <ToggleText key="video-subtitles" label={videoSubtitles ? '字幕开启' : '字幕关闭'} active={videoSubtitles} onPress={() => setVideoSubtitles(value => !value)} /> : null}{tool(`台词·${subtitleLabels[subtitles]}`, () => setSubtitles((subtitles + 1) % 4))}{tool('遮挡板', () => { setMasked(!masked); setRevealed(new Set()); }, masked)}{tool(`${playback.rate}×`, () => setSettings(true), playback.rate !== 1)}</ScrollView>
    {playback.waiting ? <FadeOnChange trigger={playback.waiting}><Text style={[styles.waiting, { color: theme.textSecondary }]}>留一点停顿，跟着说。</Text></FadeOnChange> : null}{actionError ? <Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{actionError}</Text> : null}
    {session.error ? <View><Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{session.error}</Text><Pressable accessibilityRole="button" disabled={saving} onPress={() => { setSaving(true); void session.save().then(store => { if (store) accept(store); }).catch(() => undefined).finally(() => setSaving(false)); }} style={styles.touch}><Text style={{ color: theme.accent }}>重试保存练习</Text></Pressable></View> : null}
    <View style={{ display: recordPanel ? 'flex' : 'none' }}><ShadowingRecording materialId={material.id} material={material} cueId={cue?.id ?? ''} scope={scope} saved={library.store.recordings[material.id]} pauseOriginal={pauseOriginal} onActive={onRecordingActive} onSaved={accept} /></View>
    </View></View>
    <ShadowingSettings visible={settings} close={() => setSettings(false)} rate={playback.rate} changeRate={playback.changeRate} repeatCount={playback.repeatCount} setRepeatCount={playback.setRepeatCount} gap={playback.gap} setGap={playback.setGap} fontSize={fontSize} setFontSize={setFontSize} skipGaps={skipGaps} setSkipGaps={setSkipGaps} />
    <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}><Pressable accessibilityLabel="关闭弹层" onPress={() => setSheet(null)} style={styles.backdrop}><Pressable onPress={event => event.stopPropagation()} style={styles.sheetWrap}><SheetFrame title={sheet === 'notes' ? '台词笔记' : sheet === 'explain' ? '当前句讲解' : sheet === 'words' ? '素材词汇' : sheet === 'dictionary' ? '台词查词' : '更多练习工具'}><ScrollView keyboardShouldPersistTaps="handled">
      {sheet === 'notes' ? <><Text style={{ color: theme.text, fontSize: 16, lineHeight: 25, marginBottom: 14 }}>{cue?.en}</Text><TextInput multiline accessibilityLabel="当前句笔记" value={note} onChangeText={setNote} style={[speakingStyles.input, { color: theme.text, borderColor: theme.border, minHeight: 120, textAlignVertical: 'top' }]} /><TextAction disabled={saving} label={saving ? '正在保存…' : '保存笔记'} onPress={() => void saveNote()} /></> : null}
      {sheet === 'explain' ? <><Text style={{ color: theme.text, fontFamily: fonts.reading, fontSize: 20, lineHeight: 30 }}>{cue?.en}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted, marginVertical: 15 }]}>{cue?.zh}</Text>{material.id === 'curiosity' && curiosityNotes[playback.index] ? <><Text style={{ color: theme.text, fontSize: 17, fontWeight: weight('semibold') }}>{curiosityNotes[playback.index].phrase}</Text><Text style={[speakingStyles.hint, { color: theme.textSecondary, marginVertical: 12 }]}>{curiosityNotes[playback.index].text}</Text><Text style={{ color: theme.text, fontSize: 15, lineHeight: 25 }}>{curiosityNotes[playback.index].rhythm}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 20 }]}>素材配套讲解，非 AI 生成。AI 台词讲解服务尚未开放。</Text></> : <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>这段素材暂未提供配套讲解，AI 台词讲解服务尚未开放。</Text>}</> : null}
      {sheet === 'words' ? <><TextInput accessibilityLabel="词典查询" placeholder="输入英文单词" placeholderTextColor={theme.textMuted} value={word} onChangeText={setWord} onSubmitEditing={() => lookup(word)} autoCapitalize="none" style={[speakingStyles.input, { color: theme.text, borderColor: theme.border }]} /><TextAction label="查词" disabled={!word.trim()} onPress={() => lookup(word)} />{material.origin === 'platform' ? speakingVocabulary.filter(item => material.cues.some(line => new RegExp(`\\b${item.word}\\b`, 'i').test(line.en))).map(item => <Pressable accessibilityRole="button" accessibilityLabel={`查词 ${item.word}`} onPress={() => lookup(item.word)} key={item.word} style={({ pressed }) => ({ paddingVertical: 14, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, opacity: pressed ? .6 : 1 })}><Text style={{ color: theme.text, fontFamily: fonts.readingSemibold, fontSize: 18 }}>{item.word}</Text><Text style={[speakingStyles.hint, { color: theme.textSecondary }]}>{item.meaning}</Text></Pressable>) : null}<Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 20 }]}>点按英文台词中的单词，也可以直接查询离线词典。</Text></> : null}
      {sheet === 'dictionary' ? <ShadowingDictionary key={word} term={word} /> : null}
      {sheet === 'more' ? <><SpeakingTranscriptExport material={{ ...material, cues }} notes={library.store.notes[material.id]} disabled={saving} /><View style={[styles.moreList, { borderTopColor: theme.border }]}>{([['台词笔记', '为当前句写下自己的提示', () => { setNote(library.store.notes[material.id]?.[cue?.id ?? ''] ?? ''); setSheet('notes'); }], ['练习设置', '速度、复读次数、停顿和字号', () => { setSheet(null); setSettings(true); }], ['跟读指南', '一句一句练的方法', () => openPage('/speaking/guide')], ['跟读记录', '历次练习的时长与位置', () => openPage('/speaking/history')]] as const).map(([label, hint, action]) => <ListRow key={label} label={label} hint={hint} onPress={saving ? undefined :action} />)}</View>
        <TextAction label={saving ? '正在保存…' : '完成本次跟读'} disabled={saving} onPress={() => void finish()} style={{ marginTop: 8 }} /></> : null}
      {actionError ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{actionError}</Text> : null}<TextAction label="关闭" tone="muted" onPress={() => setSheet(null)} />
    </ScrollView></SheetFrame></Pressable></Pressable></Modal>
  </View>;
}
const styles = StyleSheet.create({
  workspace: { flex: 1, minHeight: 0, width: '100%', maxWidth: 1440, alignSelf: 'center' }, mediaPane: { minWidth: 0, minHeight: 0, gap: 8 }, mediaBody: { flex: 1, minHeight: 0 },
  paneHeading: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }, materialTitle: { fontWeight: weight('semibold'), lineHeight: 21 },
  transcriptPane: { flex: 1, minWidth: 0, minHeight: 0 }, transcriptHeading: { paddingBottom: 10, borderBottomWidth: 1.5 }, transcriptTitle: { flex: 1, fontSize: 17, fontWeight: weight('bold') }, transcriptList: { flex: 1, minHeight: 0 },
  search: { borderWidth: 0, marginTop: 10 },
  page: { flex: 1 }, touch: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 8 }, toolDivider: { width: StyleSheet.hairlineWidth, height: 18, marginHorizontal: 6 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 4 }, footerInner: { maxWidth: 920, width: '100%', alignSelf: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, transportSide: { width: 64 }, transportCenter: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  play: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  modes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexGrow: 1, gap: 2 },
  waiting: { fontSize: 12, textAlign: 'center', marginBottom: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(21, 14, 16, 0.42)', justifyContent: 'flex-end' }, sheetWrap: { width: '100%' },
  moreList: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4 },
});
