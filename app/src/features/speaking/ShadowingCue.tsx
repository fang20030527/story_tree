import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { formatSpeakingTime, type SpeakingCue } from './model';
import { SpeakingSentence } from './SpeakingSentence';

export type ShadowingBlock = SpeakingCue & { index: number; endIndex: number };
type Props = {
  item: ShadowingBlock; selected: boolean; hidden: boolean; disabled: boolean; saved: boolean;
  subtitles: number; fontSize: number;
  onPlay: (id: string, start: number, reveal: boolean) => void;
  onSave: (id: string) => Promise<void>;
  onLookup: (word: string) => void;
};
const webContainment = { contentVisibility: 'auto', containIntrinsicSize: 'auto 170px' } as unknown as ViewStyle;

export const ShadowingCue = React.memo(function ShadowingCue({ item, selected, hidden, disabled, saved, subtitles, fontSize, onPlay, onSave, onLookup }: Props) {
  const { theme } = useAppTheme();
  const selectCue = () => onPlay(item.id, item.start, hidden);
  return <View nativeID={`shadowing-cue-${item.index}`} style={[styles.cue, Platform.OS === 'web' && webContainment, { backgroundColor: selected ? theme.accentSoft : theme.bg, borderLeftColor: selected ? theme.accent : 'transparent', borderBottomColor: theme.border }]}>
    <View style={styles.heading}>
      <Pressable accessibilityRole="button" accessibilityLabel={`定位第 ${item.index + 1} 句`} disabled={disabled} onPress={selectCue} style={styles.position}><Text style={{ color: theme.textMuted, fontSize: 11 }}>{item.index + 1}{item.endIndex > item.index ? `–${item.endIndex + 1}` : ''} · {formatSpeakingTime(item.start)}</Text><Ionicons name="play-outline" size={12} color={theme.accent} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${saved ? '取消收藏' : '收藏'}第 ${item.index + 1} 句`} accessibilityState={{ selected: saved }} onPress={() => void onSave(item.id)} style={styles.touch}><Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} color={theme.accent} size={19} /></Pressable>
    </View>
    {subtitles === 3 ? <Pressable accessibilityRole="button" accessibilityLabel={`播放第 ${item.index + 1} 句`} disabled={disabled} onPress={selectCue}><Text style={{ color: theme.textMuted, fontSize: 12, paddingVertical: 12 }}>字幕已关闭 · 点按播放</Text></Pressable> : hidden ? <Pressable accessibilityRole="button" accessibilityLabel={`揭开第 ${item.index + 1} 句`} disabled={disabled} onPress={selectCue} style={{ minHeight: 44 }}><Text style={{ color: theme.text, fontFamily: fonts.reading, fontSize, lineHeight: fontSize * 1.5 }}>••••••••</Text><Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 7 }}>点按揭开</Text></Pressable> : <>
      {subtitles !== 2 ? <SpeakingSentence text={item.en} size={fontSize} lookup={onLookup} /> : null}
      {subtitles !== 1 ? <Pressable accessibilityRole="button" accessibilityLabel={`播放第 ${item.index + 1} 句`} disabled={disabled} onPress={selectCue} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 23, marginTop: 7 }}>{item.zh || '点按播放这一句'}</Text></Pressable> : null}
    </>}
  </View>;
});
const styles = StyleSheet.create({
  cue: { paddingHorizontal: 22, paddingBottom: 20, borderBottomWidth: .5, borderLeftWidth: 2 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  position: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center' },
  touch: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
