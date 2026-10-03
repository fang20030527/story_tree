import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { radius } from '@/constants/theme';
import { GlyphSpeak } from '@/components/cosmos';
import { useModeAccent } from '@/context/modeAccent';
import { FadeOnChange } from '@/components/motion';
import { useAppTheme } from '@/context/ThemeContext';
import { formatSpeakingTime, type SpeakingCue } from './model';
import { SpeakingSentence } from './SpeakingSentence';

export type ShadowingBlock = SpeakingCue & { index: number; endIndex: number };
type Props = {
  item: ShadowingBlock; selected: boolean; hidden: boolean; disabled: boolean; saved: boolean;
  /** 当前句且正在播放：显示随声音跳动的小声环星。 */
  live?: boolean;
  subtitles: number; fontSize: number;
  translatedTextZh?: string;
  translationStatus?: 'loading' | 'waiting' | 'error';
  onRetryTranslation: (start: number, end: number) => void;
  onPlay: (id: string, start: number, reveal: boolean) => void;
  /** 第二个参数是点按后期望的收藏状态（显式设置，连续点按不会因请求排队而互相抵消）。 */
  onSave: (id: string, saved: boolean) => Promise<void>;
  onLookup: (word: string) => void;
};
const webContainment = { contentVisibility: 'auto', containIntrinsicSize: 'auto 170px' } as unknown as ViewStyle;

export const ShadowingCue = React.memo(function ShadowingCue({ item, selected, hidden, disabled, saved, live = false, subtitles, fontSize, translatedTextZh, translationStatus, onRetryTranslation, onPlay, onSave, onLookup }: Props) {
  const { theme } = useAppTheme();
  const accent = useModeAccent();
  const selectCue = () => onPlay(item.id, item.start, hidden);
  const sentenceColor = selected ? theme.text : theme.textSecondary;
  const chinese = translatedTextZh ?? item.zh;
  return <View nativeID={`shadowing-cue-${item.index}`} style={[styles.cue, Platform.OS === 'web' && webContainment, { backgroundColor: selected ? accent.soft : 'transparent' }]}>
    <View style={styles.heading}>
      <Pressable accessibilityRole="button" accessibilityLabel={`定位第 ${item.index + 1} 句`} disabled={disabled} onPress={selectCue} style={({ pressed }) => [styles.position, { opacity: pressed ? .6 : 1 }]}>
        <Text style={[styles.index, { color: selected ? accent.ink : theme.textMuted }]}>{String(item.index + 1).padStart(2, '0')}{item.endIndex > item.index ? `–${item.endIndex + 1}` : ''}</Text>
        <Text style={[styles.time, { color: theme.textMuted }]}>{formatSpeakingTime(item.start)}</Text>
        {selected && live ? <View style={styles.live}><GlyphSpeak size={22} playing color={accent.ink} /><Text style={[styles.liveText, { color: accent.ink }]}>正在播放</Text></View> : null}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${saved ? '取消收藏' : '收藏'}第 ${item.index + 1} 句`} accessibilityState={{ selected: saved }} onPress={() => void onSave(item.id, !saved)} hitSlop={4} style={({ pressed }) => [styles.touch, { opacity: pressed ? .6 : 1 }]}><Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} color={saved ? accent.ink : theme.textMuted} size={18} /></Pressable>
    </View>
    {subtitles === 3 ? <Pressable accessibilityRole="button" accessibilityLabel={`播放第 ${item.index + 1} 句`} disabled={disabled} onPress={selectCue}><Text style={{ color: theme.textMuted, fontSize: 12, paddingVertical: 10 }}>台词已隐藏 · 点按播放</Text></Pressable> : hidden ? <Pressable accessibilityRole="button" accessibilityLabel={`揭开第 ${item.index + 1} 句`} disabled={disabled} onPress={selectCue} style={{ minHeight: 44 }}><View style={[styles.veil, { backgroundColor: theme.surfaceAlt, height: fontSize * 1.5 }]} /><Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 8 }}>点按揭开</Text></Pressable> : <FadeOnChange trigger={selected ? 'on' : 'off'}>
      {subtitles !== 2 ? <SpeakingSentence text={item.en} size={fontSize} lookup={onLookup} color={sentenceColor} /> : null}
      {subtitles !== 1 ? <>
        {chinese.trim() ? <Pressable accessibilityRole="button" accessibilityLabel={`播放第 ${item.index + 1} 句`} disabled={disabled} onPress={selectCue} style={{ minHeight: 32, justifyContent: 'center' }}><Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 21, marginTop: 4 }}>{chinese}</Text></Pressable> : null}
        {translationStatus === 'error' ? <Pressable accessibilityRole="button" accessibilityLabel={`重试第 ${item.index + 1} 句翻译`} onPress={() => onRetryTranslation(item.index, item.endIndex)} style={{ minHeight: 32, justifyContent: 'center' }}><Text style={{ color: theme.accent, fontSize: 13, lineHeight: 21, marginTop: 4 }}>中文翻译失败 · 点按重试</Text></Pressable>
          : translationStatus || !chinese.trim() ? <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 21, marginTop: 4 }}>{translationStatus === 'loading' ? '正在翻译中文…' : translationStatus === 'waiting' ? '等待中文翻译…' : '该句暂无中文译文'}</Text> : null}
      </> : null}
    </FadeOnChange>}
  </View>;
});
const styles = StyleSheet.create({
  cue: { paddingLeft: 12, paddingRight: 4, paddingBottom: 14, marginBottom: 2, borderRadius: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  position: { flex: 1, minHeight: 40, flexDirection: 'row', gap: 8, alignItems: 'center' },
  index: { fontFamily: 'HeidongReadingSemiBold', fontSize: 12, fontVariant: ['tabular-nums'] },
  time: { fontSize: 12, fontVariant: ['tabular-nums'] },
  live: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  liveText: { fontSize: 12, fontWeight: '600' },
  veil: { borderRadius: radius.content, width: '86%' },
  touch: { minHeight: 40, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
