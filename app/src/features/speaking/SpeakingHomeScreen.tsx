import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BrandHeader, PageHeading } from '@/components/brand';
import { GlyphSpeak, Voiceprint } from '@/components/cosmos';
import { PressFeedback } from '@/components/motion';
import { radius, typeScale, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { useModeAccent } from '@/context/modeAccent';
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
  const accent = useModeAccent();
  return <PressFeedback accessibilityRole="button" accessibilityLabel={`打开${material.title}`} onPress={onPress} style={styles.materialCard}>
    <View style={[styles.cardCover, material.category === '播客' && styles.podcastCover, { backgroundColor: theme.surfaceAlt }]}>
      {cover ? <Image source={cover} accessibilityLabel={`${material.title}封面`} resizeMode="cover" style={styles.cardImage} /> : <Ionicons name={material.mediaType === 'video' ? 'videocam-outline' : 'mic-outline'} color={theme.textSecondary} size={28} />}
      {position > 0 ? <Text numberOfLines={1} style={[styles.resume, { color: accent.ink, backgroundColor: theme.bg }]}>继续 {formatSpeakingTime(position)}</Text> : null}
    </View>
    <Text numberOfLines={2} style={[styles.cardTitle, { color: theme.text }]}>{speakingTitleText(material.title)}</Text>
    <Text numberOfLines={1} style={[styles.cardMeta, { color: theme.textMuted }]}>{speakingAccentLabel(material).replace('口音：', '')} · {formatSpeakingTime(material.duration)} · {cueCount ? `${cueCount} 句` : '待添加字幕'}</Text>
  </PressFeedback>;
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
  const accent = useModeAccent();
  const featuredPosition = featured ? library.store.positions[featured.id] ?? 0 : 0;
  const featuredCues = featured ? featured.cueCount ?? featured.cues.length : 0;
  const featuredTags = featured ? [speakingAccentLabel(featured).replace('口音：', ''), ...featured.subtitle.split(/\s*·\s*/u).filter(Boolean)].slice(0, 3) : [];
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><BrandHeader modeSwitch action="search-outline" label="查找跟读素材" onPress={() => { setSearching(!searching); setQuery(''); }} /><ScrollView contentContainerStyle={speakingStyles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    <PageHeading title="素材" description="跟着声音，找到自己的表达。" />
    {searching ? <TextInput accessibilityLabel="搜索跟读素材" value={query} onChangeText={setQuery} placeholder="搜索英文标题或中文介绍" placeholderTextColor={theme.textMuted} style={[speakingStyles.input, { color: theme.text, backgroundColor: theme.surfaceAlt, marginBottom: 20 }]} /> : null}
    {featured ? <PressFeedback accessibilityRole="button" accessibilityLabel={`精选跟读：${featured.title}`} onPress={() => router.push({ pathname: '/speaking/material', params: { id: featured.id } })} style={styles.hero}>
      <View style={[styles.heroMedia, { backgroundColor: theme.surfaceAlt }]}>
        {featuredCover ? <Image source={featuredCover} accessibilityLabel={`${featured.title}封面`} resizeMode="cover" style={styles.heroCover} /> : null}
        <View style={[styles.flag, { backgroundColor: theme.bg }]}><GlyphSpeak size={26} /><Text style={[styles.flagText, { color: theme.text }]}>精选跟读</Text></View>
        {featured.duration ? <Text style={styles.duration}>{formatSpeakingTime(featured.duration)}</Text> : null}
      </View>
      <Text numberOfLines={2} style={[styles.heroTitle, { color: theme.text }]}>{speakingTitleText(featured.title)}</Text>
      <View style={[styles.progress, { backgroundColor: accent.soft }]}>
        <View style={styles.progressTop}>
          <Text style={[styles.progressLabel, { color: accent.ink }]}>{featuredPosition > 0 ? `上次练到 ${formatSpeakingTime(featuredPosition)}` : '还没开始练'}</Text>
          {featuredCues ? <Text style={[styles.progressCount, { color: theme.textMuted }]}>共 {featuredCues} 句</Text> : null}
        </View>
        <Voiceprint played={featured.duration ? featuredPosition / featured.duration : 0} color={accent.ink} />
      </View>
      <View style={styles.heroFoot}>
        {featuredTags.map((tag) => <View key={tag} style={[styles.tag, { backgroundColor: theme.surfaceAlt }]}><Text numberOfLines={1} style={[styles.tagText, { color: theme.textSecondary }]}>{tag}</Text></View>)}
        <View style={[styles.cta, { backgroundColor: theme.accent }]}><Text style={[styles.ctaText, { color: theme.accentText }]}>{featuredPosition > 0 ? '继续跟读' : '开始跟读'}</Text><Ionicons name="arrow-forward" size={14} color={theme.accentText} /></View>
      </View>
    </PressFeedback> : null}
    <SpeakingStatus loading={library.loading} error={library.error || library.catalogError} retry={library.refresh} />
    {sections.map(section => <View key={section.title} style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>{section.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看更多${section.title}素材`} onPress={() => router.push({ pathname: '/speaking/section', params: { section: section.title, ...(query.trim() ? { query: query.trim() } : {}) } })} style={({ pressed }) => [styles.more, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.moreLabel, { color: theme.textMuted }]}>更多</Text><Ionicons name="chevron-forward" size={14} color={theme.textMuted} />
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
  hero: { gap: 10, marginBottom: 6 },
  heroMedia: { borderRadius: 18, overflow: 'hidden', aspectRatio: 16 / 9, width: '100%', maxWidth: 640 },
  heroCover: { width: '100%', height: '100%' },
  flag: { position: 'absolute', left: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingLeft: 6, paddingRight: 11, borderRadius: radius.pill, opacity: 0.94 },
  flagText: { fontSize: 12.5, fontWeight: weight('semibold') },
  duration: { position: 'absolute', right: 10, bottom: 10, color: '#FFF4EA', backgroundColor: 'rgba(20, 13, 16, 0.66)', borderRadius: radius.tag, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, fontSize: 12, fontWeight: weight('semibold'), fontVariant: ['tabular-nums'] },
  heroTitle: { fontSize: 19, lineHeight: 27, fontWeight: weight('semibold'), marginTop: 4 },
  progress: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 4, maxWidth: 640 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: 12, fontWeight: weight('semibold'), fontVariant: ['tabular-nums'] },
  progressCount: { fontSize: 12, fontVariant: ['tabular-nums'] },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 640 },
  tag: { minHeight: 26, paddingHorizontal: 10, borderRadius: radius.tag, justifyContent: 'center', flexShrink: 1 },
  tagText: { fontSize: 12.5 },
  cta: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingLeft: 14, paddingRight: 12, borderRadius: radius.pill },
  ctaText: { fontSize: 13.5, fontWeight: weight('semibold') },
  section: { marginTop: 26 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  sectionTitle: { flex: 1, ...typeScale.section },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, minWidth: 60, minHeight: 44 },
  moreLabel: { fontSize: 13 },
  rail: { flexGrow: 0 },
  railContent: { gap: materialCardGap, paddingTop: 6, paddingBottom: 4 },
  materialCard: { width: materialCardWidth },
  cardCover: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.content, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  podcastCover: { aspectRatio: 1 },
  cardImage: { width: '100%', height: '100%' },
  cardTitle: { fontSize: 14.5, lineHeight: 20, fontWeight: weight('medium'), minHeight: 40, marginTop: 8, marginBottom: 3 },
  cardMeta: { fontSize: 12, lineHeight: 17, fontVariant: ['tabular-nums'] },
  resume: { position: 'absolute', bottom: 6, left: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.tag, overflow: 'hidden', fontSize: 11, lineHeight: 16, fontWeight: weight('semibold') },
});
