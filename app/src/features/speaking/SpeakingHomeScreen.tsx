import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BrandHeader, PageHeading } from '@/components/brand';
import { fonts, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingSections, speakingSectionPreview } from './catalog';
import { speakingAccentLabel } from './accents';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { speakingTitleText } from './titles';
import { speakingCover } from './covers';
import { formatSpeakingTime, type SpeakingMaterial } from './model';
import { speakingSeriesGroups } from './series';
import { SpeakingSeriesCard } from './SpeakingSeriesComponents';
import { speakingPodcastGroups } from './podcasts';
import { SpeakingPodcastCard } from './SpeakingPodcastComponents';

const sectionPreviewLimit = 3;
const materialCardWidth = 176;
const materialCardGap = 12;

function SpeakingMaterialCard({ material, position = 0, onPress }: { material: SpeakingMaterial; position?: number; onPress: () => void }) {
  const { theme } = useAppTheme();
  const cover = speakingCover(material.id);
  const cueCount = material.cueCount ?? material.cues.length;
  return <Pressable accessibilityRole="button" accessibilityLabel={`打开${material.title}`} onPress={onPress} style={({ pressed }) => [styles.materialCard, { opacity: pressed ? 0.7 : 1 }]}>
    <View style={[styles.cardCover, material.category === '播客' && styles.podcastCover, { backgroundColor: theme.surfaceAlt }]}>
      {cover ? <Image source={cover} accessibilityLabel={`${material.title}封面`} resizeMode="cover" style={styles.cardImage} /> : <Ionicons name={material.mediaType === 'video' ? 'videocam-outline' : 'mic-outline'} color={theme.textSecondary} size={28} />}
      {position > 0 ? <Text numberOfLines={1} style={[styles.resume, { color: theme.accent, backgroundColor: theme.bg }]}>继续 {formatSpeakingTime(position)}</Text> : null}
    </View>
    <Text numberOfLines={2} style={[styles.cardTitle, { color: theme.text }]}>{speakingTitleText(material.title)}</Text>
    <Text numberOfLines={1} style={[styles.cardMeta, { color: theme.textMuted }]}>{speakingAccentLabel(material)}</Text>
    <Text numberOfLines={1} style={[styles.cardMeta, { color: theme.textMuted }]}>{formatSpeakingTime(material.duration)} · {cueCount ? `${cueCount} 句字幕` : '待添加字幕'}</Text>
  </Pressable>;
}

export function SpeakingHomeScreen() {
  const { theme } = useAppTheme();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const library = useSpeakingLibrary();
  const sections = speakingSections(library.materials, query);
  const series = speakingSeriesGroups(library.materials, query);
  const podcasts = speakingPodcastGroups(library.materials, query);
  const platformMaterials = library.materials.filter(item => item.origin === 'platform');
  const featured = query.trim() ? undefined : platformMaterials.find(item => item.id === 'steve-jobs-stanford-2005') ?? platformMaterials[0];
  const featuredCover = featured ? speakingCover(featured.id) : undefined;
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><BrandHeader action="search-outline" label="查找跟读素材" onPress={() => { setSearching(!searching); setQuery(''); }} /><ScrollView contentContainerStyle={speakingStyles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    <PageHeading title="素材" description="跟着声音，找到自己的表达。" />
    {searching ? <TextInput accessibilityLabel="搜索跟读素材" value={query} onChangeText={setQuery} placeholder="搜索英文标题或中文介绍" placeholderTextColor={theme.textMuted} style={[speakingStyles.input, { color: theme.text, borderColor: theme.border, marginBottom: 20 }]} /> : null}
    {featured ? <Pressable accessibilityRole="button" accessibilityLabel={`精选跟读：${featured.title}`} onPress={() => router.push({ pathname: '/speaking/material', params: { id: featured.id } })} style={[styles.hero, { borderTopColor: theme.text, borderBottomColor: theme.border }]}>
      {featuredCover ? <Image source={featuredCover} accessibilityLabel={`${featured.title}封面`} resizeMode="cover" style={styles.heroCover} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: theme.textMuted, fontFamily: fonts.label, fontSize: 11, letterSpacing: 0.3 }}>精选跟读</Text><Text numberOfLines={3} style={[styles.heroTitle, { color: theme.text }]}>{speakingTitleText(featured.title)}</Text><Text numberOfLines={2} style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 19, marginTop: 8 }}>{speakingAccentLabel(featured)} · {featured.subtitle}</Text></View><Ionicons name="arrow-forward" color={theme.accent} size={20} />
    </Pressable> : null}
    <SpeakingStatus loading={library.loading} error={library.error || library.catalogError} retry={library.refresh} />
    {sections.map(section => <View key={section.title} style={styles.section}>
      <View style={[styles.sectionHeader, { borderBottomColor: theme.text }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>{section.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看更多${section.title}素材`} onPress={() => router.push({ pathname: '/speaking/section', params: { section: section.title, ...(query.trim() ? { query: query.trim() } : {}) } })} style={({ pressed }) => [styles.more, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.moreLabel, { color: theme.accent }]}>更多</Text><Ionicons name="arrow-forward" size={16} color={theme.accent} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} directionalLockEnabled nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.rail} contentContainerStyle={styles.railContent}>
        {section.title === '美剧/英剧'
          ? series.slice(0, sectionPreviewLimit).map(item => <SpeakingSeriesCard key={item.id} series={item} onPress={() => router.push({ pathname: '/speaking/series', params: { series: item.id } })} />)
          : section.title === '播客'
            ? podcasts.slice(0, sectionPreviewLimit).map(item => <SpeakingPodcastCard key={item.id} podcast={item} onPress={() => router.push({ pathname: '/speaking/podcast', params: { podcast: item.id } })} />)
            : speakingSectionPreview(section.materials, sectionPreviewLimit).map(item => <SpeakingMaterialCard key={item.id} material={item} position={library.store.positions[item.id]} onPress={() => router.push({ pathname: '/speaking/material', params: { id: item.id } })} />)}
      </ScrollView>
    </View>)}
    {!library.loading && !library.error && !library.catalogError && !sections.length ? <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{query.trim() ? '没有匹配的素材，请换个关键词。' : '暂无跟读素材，请稍后再来看看。'}</Text> : null}
    <Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 24 }]}>听懂一句，再开口跟读。也可在「文件」里导入自己的音视频。</Text>
  </ScrollView></View>;
}
const styles = StyleSheet.create({
  hero: { borderTopWidth: 2, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 16, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroCover: { width: 112, height: 96, borderRadius: 4 }, heroTitle: { fontSize: 22, lineHeight: 29, fontWeight: '700', marginTop: 8 },
  section: { marginTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottomWidth: 1, paddingBottom: 4 },
  sectionTitle: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: weight('bold') },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 60, minHeight: 44 },
  moreLabel: { fontSize: 13 },
  rail: { flexGrow: 0 },
  railContent: { gap: materialCardGap, paddingTop: 14, paddingBottom: 4 },
  materialCard: { width: materialCardWidth },
  cardCover: { width: '100%', aspectRatio: 16 / 9, borderRadius: 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  podcastCover: { aspectRatio: 1 },
  cardImage: { width: '100%', height: '100%' },
  cardTitle: { fontSize: 15, lineHeight: 21, fontWeight: weight('bold'), minHeight: 42, marginTop: 8, marginBottom: 4 },
  cardMeta: { fontSize: 11, lineHeight: 17 },
  resume: { position: 'absolute', bottom: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontSize: 10, lineHeight: 15 },
});
