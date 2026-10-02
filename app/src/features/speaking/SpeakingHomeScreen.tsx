import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BrandHeader, PageHeading } from '@/components/brand';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingCategories } from './catalog';
import { speakingAccentLabel } from './accents';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingMaterialRow, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { speakingCover } from './covers';

export function SpeakingHomeScreen() {
  const { theme } = useAppTheme();
  const [category, setCategory] = useState('');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const library = useSpeakingLibrary();
  const categories = speakingCategories.filter(item => library.materials.some(material => material.origin === 'platform' && material.category === item));
  const selectedCategory = categories.includes(category) ? category : categories[0];
  const platformMaterials = library.materials.filter(item => item.origin === 'platform');
  const featured = platformMaterials.find(item => item.id === 'steve-jobs-stanford-2005') ?? platformMaterials[0];
  const featuredCover = featured ? speakingCover(featured.id) : undefined;
  const matches = platformMaterials.filter(item => selectedCategory === item.category && `${item.title} ${item.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><BrandHeader action="search-outline" label="查找跟读素材" onPress={() => { setSearching(!searching); setQuery(''); }} /><ScrollView contentContainerStyle={speakingStyles.content} showsVerticalScrollIndicator={false}>
    <PageHeading title="素材" description="跟着声音，找到自己的表达。" />
    {searching ? <TextInput accessibilityLabel="搜索跟读素材" value={query} onChangeText={setQuery} placeholder="搜索英文标题或中文介绍" placeholderTextColor={theme.textMuted} style={[speakingStyles.input, { color: theme.text, borderColor: theme.border, marginBottom: 20 }]} /> : null}
    {featured ? <Pressable accessibilityRole="button" accessibilityLabel={`精选跟读：${featured.title}`} onPress={() => router.push({ pathname: '/speaking/material', params: { id: featured.id } })} style={[styles.hero, { borderTopColor: theme.text, borderBottomColor: theme.border }]}>
      {featuredCover ? <Image source={featuredCover} accessibilityLabel={`${featured.title}封面`} resizeMode="cover" style={styles.heroCover} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: theme.textMuted, fontFamily: fonts.label, fontSize: 11, letterSpacing: 0.3 }}>精选跟读</Text><Text numberOfLines={3} style={[styles.heroTitle, { color: theme.text }]}>{featured.title}</Text><Text numberOfLines={2} style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 19, marginTop: 8 }}>{speakingAccentLabel(featured)} · {featured.subtitle}</Text></View><Ionicons name="arrow-forward" color={theme.accent} size={20} />
    </Pressable> : null}
    <View style={speakingStyles.chips}>{categories.map(item => <Pressable key={item} onPress={() => setCategory(item)} accessibilityRole="button" accessibilityState={{ selected: item === selectedCategory }} style={[speakingStyles.chip, { borderColor: theme.border, backgroundColor: selectedCategory === item ? theme.text : 'transparent' }]}><Text style={{ color: selectedCategory === item ? theme.bg : theme.textSecondary }}>{item}</Text></Pressable>)}</View>
    <SpeakingStatus loading={library.loading} error={library.error || library.catalogError} retry={library.refresh} />
    {matches.map(item => <SpeakingMaterialRow key={item.id} material={item} position={library.store.positions[item.id]} onPress={() => router.push({ pathname: '/speaking/material', params: { id: item.id } })} />)}
    {!library.loading && !library.catalogError && !matches.length ? <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>没有匹配的素材，请换个关键词或分类。</Text> : null}
    <Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 20 }]}>精选演讲与电影对白，听懂一句，再开口跟读。也可导入自己的音视频。</Text>
  </ScrollView></View>;
}
const styles = StyleSheet.create({ hero: { borderTopWidth: 2, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 16, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 6 }, heroCover: { width: 112, height: 96, borderRadius: 4 }, heroTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, marginTop: 8 } });
