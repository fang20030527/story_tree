import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, radius } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { useLearningMode } from '@/context/LearningModeContext';
import { formatSpeakingTime, type SpeakingMaterial } from './model';
import { speakingAccentLabel } from './accents';
import { speakingCover } from './covers';

export function SpeakingHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { mode, setMode } = useLearningMode();
  useFocusEffect(useCallback(() => { if (mode !== 'speak') setMode('speak'); }, [mode, setMode]));
  return <View style={[styles.header, { paddingTop: insets.top + 4, backgroundColor: theme.bg }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.touch}><Ionicons name="arrow-back" size={24} color={theme.text} /></Pressable>
    <Text numberOfLines={1} accessibilityRole="header" style={{ color: theme.text, fontSize: 16, flex: 1, textAlign: 'center' }}>{title}</Text>
    <View style={styles.touch}>{action}</View>
  </View>;
}
export function SpeakingButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { theme } = useAppTheme();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={[styles.primary, { backgroundColor: disabled ? theme.surfaceAlt : theme.accent }]}>
    <Text style={{ color: disabled ? theme.textMuted : theme.accentText, fontSize: 15 }}>{label}</Text><Ionicons name="arrow-forward" size={21} color={disabled ? theme.textMuted : theme.accentText} />
  </Pressable>;
}
export function SpeakingStatus({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  const { theme } = useAppTheme();
  if (loading) return <ActivityIndicator accessibilityLabel="正在读取口语素材" color={theme.accent} style={{ marginVertical: 24 }} />;
  if (!error) return null;
  return <View style={{ gap: 12, paddingVertical: 24 }}><Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text><SpeakingButton label="重试" onPress={retry} /></View>;
}
export function SpeakingMaterialRow({ material, onPress, position = 0 }: { material: SpeakingMaterial; onPress: () => void; position?: number }) {
  const { theme } = useAppTheme();
  const cover = material.origin === 'platform' ? speakingCover(material.id) : undefined;
  return <Pressable accessibilityRole="button" accessibilityLabel={`打开${material.title}`} onPress={onPress} style={[styles.row, { borderBottomColor: theme.border }]}>
    {cover ? <Image source={cover} accessibilityLabel={`${material.title}封面`} resizeMode="cover" style={[styles.cover, { backgroundColor: theme.surfaceAlt }]} /> : <View style={[styles.art, { backgroundColor: theme.surfaceAlt }]}><Ionicons name={material.mediaType === 'video' ? 'videocam-outline' : 'mic-outline'} color={theme.textSecondary} size={24} /></View>}
    <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.title, { color: theme.text }]}>{material.title}</Text><Text style={[styles.hint, { color: theme.textMuted }]}>{speakingAccentLabel(material)} · {material.subtitle || material.category}</Text><Text style={[styles.hint, { color: theme.textMuted }]}>{formatSpeakingTime(material.duration)} · {(material.cueCount ?? material.cues.length) ? `${material.cueCount ?? material.cues.length} 句字幕` : '待添加字幕'}{position > 0 ? ` · 继续 ${formatSpeakingTime(position)}` : ''}</Text></View>
    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
  </Pressable>;
}
export const speakingStyles = StyleSheet.create({
  page: { flex: 1 }, content: { padding: 24, width: '100%', maxWidth: 960, alignSelf: 'center', paddingBottom: 40 },
  heading: { fontSize: 32, lineHeight: 40, fontWeight: '700', marginBottom: 10 }, hint: { fontSize: 12, lineHeight: 21 },
  section: { fontSize: 17, fontWeight: '700', marginTop: 28, marginBottom: 12 }, error: { fontSize: 12, lineHeight: 20, marginVertical: 12 },
  input: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 16, padding: 12, minHeight: 46, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 16 },
  chip: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderRadius: radius.pill },
});
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 8, gap: 8 }, touch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  primary: { paddingHorizontal: 18, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.pill, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  art: { width: 54, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  cover: { width: 112, height: 72, borderRadius: 4 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28 }, hint: { fontSize: 11, lineHeight: 18, marginTop: 5 },
});
