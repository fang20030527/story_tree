import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, weight } from '@/constants/theme';
import { BlackHoleLoader, EnterOnce, LostPlanet } from '@/components/cosmos';
import { useAppTheme } from '@/context/ThemeContext';
import { useLearningMode } from '@/context/LearningModeContext';
import { formatSpeakingTime, type SpeakingMaterial } from './model';
import { speakingAccentLabel } from './accents';
import { speakingCover } from './covers';
import { speakingTitleText } from './titles';
import { speakingSectionTitle } from './catalog';

export function SpeakingHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { mode, setMode } = useLearningMode();
  useFocusEffect(useCallback(() => { if (mode !== 'speak') setMode('speak'); }, [mode, setMode]));
  return <View style={[styles.header, { paddingTop: insets.top + 4, backgroundColor: theme.bg }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.touch}><Ionicons name="chevron-back" size={24} color={theme.text} /></Pressable>
    <Text numberOfLines={1} accessibilityRole="header" style={{ color: theme.text, fontSize: 16, fontWeight: weight('semibold'), flex: 1, textAlign: 'center' }}>{title}</Text>
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
  if (loading) return <View accessibilityLabel="正在读取口语素材" style={{ alignItems: 'center', marginVertical: 18 }}><BlackHoleLoader size={120} label="正在读取口语素材" /></View>;
  if (!error) return null;
  return <View style={{ gap: 10, paddingVertical: 20, alignItems: 'center' }}>
    <EnterOnce><LostPlanet size={170} /></EnterOnce>
    <Text accessibilityRole="alert" style={{ color: theme.text, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>{error}</Text>
    <View style={{ alignSelf: 'stretch' }}><SpeakingButton label="重试" onPress={retry} /></View>
  </View>;
}

export function SpeakingMaterialRow({ material, onPress, position = 0 }: { material: SpeakingMaterial; onPress: () => void; position?: number }) {
  const { theme } = useAppTheme();
  const cover = material.origin === 'platform' ? speakingCover(material.id) : undefined;
  return <Pressable accessibilityRole="button" accessibilityLabel={`打开${material.title}`} onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.86 : 1 }]}>
    {cover ? <Image source={cover} accessibilityLabel={`${material.title}封面`} resizeMode="cover" style={[styles.cover, material.category === '播客' && styles.podcastCover, { backgroundColor: theme.surfaceAlt }]} /> : <View style={[styles.art, { backgroundColor: theme.surfaceAlt }]}><Ionicons name={material.mediaType === 'video' ? 'videocam-outline' : 'mic-outline'} color={theme.textSecondary} size={24} /></View>}
    <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.title, { color: theme.text }]}>{speakingTitleText(material.title)}</Text><Text style={[styles.hint, { color: theme.textMuted }]}>{speakingAccentLabel(material)} · {material.subtitle || speakingSectionTitle(material.category)}</Text><Text style={[styles.hint, { color: theme.textMuted }]}>{formatSpeakingTime(material.duration)} · {(material.cueCount ?? material.cues.length) ? `${material.cueCount ?? material.cues.length} 句字幕` : '待添加字幕'}{position > 0 ? ` · 继续 ${formatSpeakingTime(position)}` : ''}</Text></View>
    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
  </Pressable>;
}
export const speakingStyles = StyleSheet.create({
  page: { flex: 1 }, content: { padding: 24, width: '100%', maxWidth: 960, alignSelf: 'center', paddingBottom: 40 },
  heading: { fontSize: 27, lineHeight: 36, fontWeight: '600', marginBottom: 10 }, hint: { fontSize: 12.5, lineHeight: 20 },
  section: { fontSize: 19, lineHeight: 26, fontWeight: '600', marginTop: 28, marginBottom: 12 }, error: { fontSize: 12.5, lineHeight: 20, marginVertical: 12 },
  input: { borderRadius: radius.pill, paddingHorizontal: 16, padding: 12, minHeight: 46, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 16 },
  chip: { minHeight: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill },
});
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 8, gap: 8 }, touch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  primary: { paddingHorizontal: 18, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.pill, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  art: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  cover: { width: 112, height: 72, borderRadius: 12 },
  podcastCover: { width: 72 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: weight('semibold') }, hint: { fontSize: 12, lineHeight: 18, marginTop: 3 },
});
