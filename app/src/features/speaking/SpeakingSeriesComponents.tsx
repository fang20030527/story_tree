import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingCover } from './covers';
import { speakingSeriesCountLabel, type SpeakingSeries } from './series';

export function SpeakingSeriesCard({ series, onPress }: { series: SpeakingSeries; onPress: () => void }) {
  const { theme } = useAppTheme();
  const cover = speakingCover(series.seasons[0]?.episodes[0]?.material.id ?? series.id);
  return <Pressable accessibilityRole="button" accessibilityLabel={`打开${series.title}选集`} onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.86 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    <View style={[styles.cardCover, { backgroundColor: theme.surfaceAlt }]}>
      {cover ? <Image source={cover} accessibilityLabel={`${series.title}封面`} resizeMode="cover" style={styles.image} /> : <Ionicons name="tv-outline" size={28} color={theme.textSecondary} />}
    </View>
    <Text numberOfLines={2} style={[styles.cardTitle, { color: theme.text }]}>{series.title}</Text>
    {series.englishTitle ? <Text numberOfLines={1} style={[styles.cardMeta, { color: theme.textMuted }]}>{series.englishTitle}</Text> : null}
    <Text style={[styles.cardMeta, { color: theme.textMuted }]}>{speakingSeriesCountLabel(series)}</Text>
  </Pressable>;
}

export function SpeakingSeriesRow({ series, onPress }: { series: SpeakingSeries; onPress: () => void }) {
  const { theme } = useAppTheme();
  const cover = speakingCover(series.seasons[0]?.episodes[0]?.material.id ?? series.id);
  return <Pressable accessibilityRole="button" accessibilityLabel={`打开${series.title}选集`} onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.86 : 1 }]}>
    <View style={[styles.rowCover, { backgroundColor: theme.surfaceAlt }]}>
      {cover ? <Image source={cover} accessibilityLabel={`${series.title}封面`} resizeMode="cover" style={styles.image} /> : <Ionicons name="tv-outline" size={28} color={theme.textSecondary} />}
    </View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[styles.rowTitle, { color: theme.text }]}>{series.title}</Text>
      {series.englishTitle ? <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{series.englishTitle}</Text> : null}
      <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{speakingSeriesCountLabel(series)}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { width: 176 },
  cardCover: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  cardTitle: { fontSize: 14.5, lineHeight: 20, fontWeight: weight('medium'), marginTop: 8, marginBottom: 3 },
  cardMeta: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  rowCover: { width: 112, height: 72, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: weight('semibold') },
  rowMeta: { fontSize: 12, lineHeight: 18, marginTop: 2 },
});
