import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { PageHeading } from '@/components/brand';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingSections, speakingSectionTitle } from './catalog';
import { SpeakingHeader, SpeakingMaterialRow, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { speakingSeriesGroups } from './series';
import { SpeakingSeriesRow } from './SpeakingSeriesComponents';
import { speakingPodcastGroups } from './podcasts';
import { SpeakingPodcastRow } from './SpeakingPodcastComponents';

export function SpeakingSectionScreen() {
  const { theme } = useAppTheme();
  const params = useLocalSearchParams<{ section?: string | string[]; query?: string | string[] }>();
  const sectionName = speakingSectionTitle(typeof params.section === 'string' ? params.section : '');
  const [query, setQuery] = useState(() => typeof params.query === 'string' ? params.query : '');
  const library = useSpeakingLibrary();
  const section = speakingSections(library.materials).find(item => item.title === sectionName);
  const matches = speakingSections(library.materials, query).find(item => item.title === sectionName)?.materials ?? [];
  const error = library.error || library.catalogError;
  const isSeries = sectionName === '美剧/英剧';
  const series = speakingSeriesGroups(library.materials, query);
  const seriesCount = speakingSeriesGroups(library.materials).length;
  const isPodcast = sectionName === '播客';
  const podcasts = speakingPodcastGroups(library.materials, query);
  const podcastCount = speakingPodcastGroups(library.materials).length;
  const listHeader = <>
    <PageHeading title={sectionName || '素材栏目'} description={isSeries ? `共 ${seriesCount} 部电视剧` : isPodcast ? `共 ${podcastCount} 档播客` : section ? `共 ${section.materials.length} 个跟读素材` : '栏目内的全部跟读素材。'} />
    <View style={styles.search}>
      <TextInput accessibilityLabel={isSeries ? '搜索电视剧' : isPodcast ? '搜索播客' : '搜索栏目素材'} value={query} onChangeText={setQuery} placeholder={isSeries ? '搜索剧名或季集编号' : isPodcast ? '搜索节目、嘉宾或期号' : '搜索这个栏目的素材'} placeholderTextColor={theme.textMuted} style={[speakingStyles.input, { color: theme.text, borderColor: theme.border }]} />
    </View>
    <SpeakingStatus loading={library.loading} error={error} retry={library.refresh} />
  </>;
  const empty = !library.loading && !error ? <Text style={[speakingStyles.hint, styles.empty, { color: theme.textMuted }]}>{section ? '没有匹配的素材，请换个关键词。' : '这个栏目暂无素材，请返回素材页。'}</Text> : null;

  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}>
    <SpeakingHeader title={sectionName || '素材栏目'} />
    {isSeries ? <FlatList
      data={series}
      keyExtractor={item => item.id}
      contentContainerStyle={speakingStyles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={listHeader}
      renderItem={({ item }) => <SpeakingSeriesRow series={item} onPress={() => router.push({ pathname: '/speaking/series', params: { series: item.id } })} />}
      ListEmptyComponent={empty}
    /> : isPodcast ? <FlatList
      data={podcasts}
      keyExtractor={item => item.id}
      contentContainerStyle={speakingStyles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={listHeader}
      renderItem={({ item }) => <SpeakingPodcastRow podcast={item} onPress={() => router.push({ pathname: '/speaking/podcast', params: { podcast: item.id } })} />}
      ListEmptyComponent={empty}
    /> : <FlatList
      data={matches}
      keyExtractor={item => item.id}
      contentContainerStyle={speakingStyles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      extraData={library.store.positions}
      ListHeaderComponent={listHeader}
      renderItem={({ item }) => <SpeakingMaterialRow material={item} position={library.store.positions[item.id]} onPress={() => router.push({ pathname: '/speaking/material', params: { id: item.id } })} />}
      ListEmptyComponent={empty}
    />}
  </View>;
}

const styles = StyleSheet.create({
  search: { paddingTop: 8, paddingBottom: 4 },
  empty: { paddingVertical: 24 },
});
