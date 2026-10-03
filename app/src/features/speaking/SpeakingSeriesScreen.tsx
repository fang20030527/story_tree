import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { SpeakingHeader, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { speakingCover } from './covers';
import { formatSpeakingTime } from './model';
import { speakingSeriesCountLabel, speakingSeriesGroups } from './series';
import { useSpeakingLibrary } from './useSpeakingLibrary';

export function SpeakingSeriesScreen() {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ series?: string | string[] }>();
  const seriesId = typeof params.series === 'string' ? params.series : '';
  const [selection, setSelection] = useState<{ seriesId: string; season: number }>();
  const library = useSpeakingLibrary();
  const series = speakingSeriesGroups(library.materials).find(item => item.id === seriesId);
  const selectedSeason = (selection?.seriesId === seriesId ? series?.seasons.find(item => item.number === selection.season) : undefined) ?? series?.seasons[0];
  const cover = speakingCover(series?.seasons[0]?.episodes[0]?.material.id ?? seriesId);
  const error = library.error || library.catalogError;
  const cellWidth = (Math.min(width, 960) - 48 - 24) / 4;

  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}>
    <SpeakingHeader title={series?.title ?? '选集'} />
    <FlatList
      data={selectedSeason?.episodes ?? []}
      numColumns={4}
      keyExtractor={item => item.material.id}
      contentContainerStyle={speakingStyles.content}
      columnWrapperStyle={styles.episodeRow}
      showsVerticalScrollIndicator={false}
      extraData={library.store.positions}
      ListHeaderComponent={<>
        {series ? <>
          <View style={styles.hero}>
            <View style={[styles.cover, { backgroundColor: theme.surfaceAlt }]}>
              {cover ? <Image source={cover} accessibilityLabel={`${series.title}封面`} resizeMode="cover" style={styles.image} /> : <Ionicons name="tv-outline" size={28} color={theme.textSecondary} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{series.title}</Text>
              {series.englishTitle ? <Text style={[styles.englishTitle, { color: theme.textSecondary }]}>{series.englishTitle}</Text> : null}
              <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{speakingSeriesCountLabel(series)}</Text>
            </View>
          </View>
          <View style={[styles.selectionHeading, { borderBottomColor: theme.text }]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>选集</Text>
            <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>本季 {selectedSeason?.episodes.length ?? 0} 集</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasons}>
            {series.seasons.map(season => {
              const selected = selectedSeason?.number === season.number;
              return <Pressable key={season.number} accessibilityRole="button" accessibilityLabel={`选择第${season.number}季`} accessibilityState={{ selected }} onPress={() => setSelection({ seriesId, season: season.number })} style={[speakingStyles.chip, { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accent : theme.bg }]}>
                <Text style={{ fontSize: 13, color: selected ? theme.accentText : theme.text }}>第{season.number}季</Text>
              </Pressable>;
            })}
          </ScrollView>
        </> : null}
        <SpeakingStatus loading={library.loading} error={error} retry={library.refresh} />
      </>}
      renderItem={({ item }) => {
        const position = library.store.positions[item.material.id] ?? 0;
        return <Pressable accessibilityRole="button" accessibilityLabel={`打开${series?.title ?? '电视剧'}第${item.season}季第${item.number}集`} onPress={() => router.push({ pathname: '/speaking/material', params: { id: item.material.id } })} style={({ pressed }) => [styles.episode, { width: cellWidth, borderColor: theme.border, backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.episodeTitle, { color: theme.text }]}>第{item.number}集</Text>
          <Text numberOfLines={1} style={[styles.episodeMeta, { color: position > 0 ? theme.accent : theme.textMuted }]}>{position > 0 ? `继续 ${formatSpeakingTime(position)}` : formatSpeakingTime(item.material.duration)}</Text>
        </Pressable>;
      }}
      ListEmptyComponent={!library.loading && !error ? <Text style={[speakingStyles.hint, { color: theme.textMuted, paddingVertical: 24 }]}>这部电视剧暂时没有可用剧集。</Text> : null}
    />
  </View>;
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: 16, alignItems: 'center', marginBottom: 28 },
  cover: { width: 112, height: 84, borderRadius: 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  title: { fontSize: 26, lineHeight: 34, fontWeight: weight('bold'), marginBottom: 4 },
  englishTitle: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  selectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, paddingBottom: 12 },
  sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: weight('bold') },
  seasons: { gap: 8, paddingVertical: 18 },
  episodeRow: { gap: 8, marginBottom: 8 },
  episode: { minHeight: 68, borderWidth: 1, borderRadius: 4, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 12, gap: 5 },
  episodeTitle: { fontSize: 14, fontWeight: weight('semibold') },
  episodeMeta: { fontSize: 10, lineHeight: 16 },
});
