import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { SpeakingHeader, SpeakingMaterialRow, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { speakingCover } from './covers';
import { speakingPodcastGroups } from './podcasts';
import { useSpeakingLibrary } from './useSpeakingLibrary';

export function SpeakingPodcastScreen() {
  const { theme } = useAppTheme();
  const params = useLocalSearchParams<{ podcast?: string | string[] }>();
  const podcastId = typeof params.podcast === 'string' ? params.podcast : '';
  const [search, setSearch] = useState({ podcastId, query: '' });
  const query = search.podcastId === podcastId ? search.query : '';
  const library = useSpeakingLibrary();
  const podcast = speakingPodcastGroups(library.materials).find(item => item.id === podcastId);
  const keyword = query.trim().toLowerCase();
  const episodes = podcast?.episodes.filter(material => `${material.id} ${material.title} ${material.subtitle}`.toLowerCase().includes(keyword)) ?? [];
  const cover = speakingCover(podcast?.episodes[0]?.id ?? podcastId);
  const error = library.error || library.catalogError;

  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}>
    <SpeakingHeader title={podcast?.title ?? '播客选集'} />
    <FlatList
      data={episodes}
      keyExtractor={item => item.id}
      contentContainerStyle={speakingStyles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      extraData={library.store.positions}
      ListHeaderComponent={<>
        {podcast ? <>
          <View style={styles.hero}>
            <View style={[styles.cover, { backgroundColor: theme.surfaceAlt }]}>
              {cover ? <Image source={cover} accessibilityLabel={`${podcast.title}封面`} resizeMode="cover" style={styles.image} /> : <Ionicons name="mic-outline" size={28} color={theme.textSecondary} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{podcast.title}</Text>
              {podcast.englishTitle ? <Text style={[styles.englishTitle, { color: theme.textSecondary }]}>{podcast.englishTitle}</Text> : null}
              <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>共 {podcast.episodeCount} 期</Text>
            </View>
          </View>
          <View style={[styles.selectionHeading, { borderBottomColor: theme.text }]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>选集</Text>
          </View>
          <TextInput accessibilityLabel="搜索播客单集" value={query} onChangeText={value => setSearch({ podcastId, query: value })} placeholder="搜索嘉宾、话题或期号" placeholderTextColor={theme.textMuted} style={[speakingStyles.input, styles.search, { color: theme.text, borderColor: theme.border }]} />
        </> : null}
        <SpeakingStatus loading={library.loading} error={error} retry={library.refresh} />
      </>}
      renderItem={({ item }) => <SpeakingMaterialRow material={item} position={library.store.positions[item.id]} onPress={() => router.push({ pathname: '/speaking/material', params: { id: item.id } })} />}
      ListEmptyComponent={!library.loading && !error ? <Text style={[speakingStyles.hint, styles.empty, { color: theme.textMuted }]}>{podcast ? '没有匹配的单集，请换个关键词。' : '这个节目暂时没有可用单集。'}</Text> : null}
    />
  </View>;
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: 16, alignItems: 'center', marginBottom: 28 },
  cover: { width: 112, height: 112, borderRadius: 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  title: { fontSize: 26, lineHeight: 34, fontWeight: weight('bold'), marginBottom: 4 },
  englishTitle: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  selectionHeading: { borderBottomWidth: 1, paddingBottom: 12 },
  sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: weight('bold') },
  search: { marginTop: 18 },
  empty: { paddingVertical: 24 },
});
