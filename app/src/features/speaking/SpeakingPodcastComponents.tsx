import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingCover } from './covers';
import type { SpeakingPodcast } from './podcasts';

export function SpeakingPodcastCard({ podcast, onPress }: { podcast: SpeakingPodcast; onPress: () => void }) {
  const { theme } = useAppTheme();
  const cover = speakingCover(podcast.episodes[0]?.id ?? podcast.id);
  return <Pressable accessibilityRole="button" accessibilityLabel={`打开${podcast.title}选集`} onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.86 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    <View style={[styles.cardCover, { backgroundColor: theme.surfaceAlt }]}>
      {cover ? <Image source={cover} accessibilityLabel={`${podcast.title}封面`} resizeMode="cover" style={styles.image} /> : <Ionicons name="mic-outline" size={28} color={theme.textSecondary} />}
    </View>
    <Text numberOfLines={2} style={[styles.cardTitle, { color: theme.text }]}>{podcast.title}</Text>
    {podcast.englishTitle ? <Text numberOfLines={1} style={[styles.cardMeta, { color: theme.textMuted }]}>{podcast.englishTitle}</Text> : null}
    <Text style={[styles.cardMeta, { color: theme.textMuted }]}>共 {podcast.episodeCount} 期</Text>
  </Pressable>;
}

export function SpeakingPodcastRow({ podcast, onPress }: { podcast: SpeakingPodcast; onPress: () => void }) {
  const { theme } = useAppTheme();
  const cover = speakingCover(podcast.episodes[0]?.id ?? podcast.id);
  return <Pressable accessibilityRole="button" accessibilityLabel={`打开${podcast.title}选集`} onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.86 : 1 }]}>
    <View style={[styles.rowCover, { backgroundColor: theme.surfaceAlt }]}>
      {cover ? <Image source={cover} accessibilityLabel={`${podcast.title}封面`} resizeMode="cover" style={styles.image} /> : <Ionicons name="mic-outline" size={28} color={theme.textSecondary} />}
    </View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[styles.rowTitle, { color: theme.text }]}>{podcast.title}</Text>
      {podcast.englishTitle ? <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{podcast.englishTitle}</Text> : null}
      <Text style={[styles.rowMeta, { color: theme.textMuted }]}>共 {podcast.episodeCount} 期</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { width: 176 },
  cardCover: { width: '100%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  cardTitle: { fontSize: 14.5, lineHeight: 20, fontWeight: weight('medium'), marginTop: 8, marginBottom: 3 },
  cardMeta: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  rowCover: { width: 72, height: 72, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: weight('semibold') },
  rowMeta: { fontSize: 12, lineHeight: 18, marginTop: 2 },
});
