import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BrandHeader, PageHeading } from '@/components/brand';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingCategories } from './catalog';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingMaterialRow, SpeakingStatus, speakingStyles } from './SpeakingComponents';

export function SpeakingHomeScreen() {
  const { theme } = useAppTheme();
  const [category, setCategory] = useState('全部');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const library = useSpeakingLibrary();
  const featured = library.materials[0];
  const matches = library.materials.filter(item => item.origin === 'platform' && (category === '全部' || category === item.category) && `${item.title} ${item.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><BrandHeader action="search-outline" label="查找跟读素材" onPress={() => { setSearching(!searching); setQuery(''); }} /><ScrollView contentContainerStyle={speakingStyles.content} showsVerticalScrollIndicator={false}>
    <PageHeading title="素材" description="跟着声音，找到自己的表达。" />
    {searching ? <TextInput accessibilityLabel="搜索跟读素材" value={query} onChangeText={setQuery} placeholder="搜索英文标题或中文介绍" placeholderTextColor={theme.textMuted} style={[speakingStyles.input, { color: theme.text, borderColor: theme.border, marginBottom: 20 }]} /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`今日跟读：${featured.title}`} onPress={() => router.push({ pathname: '/speaking/material', params: { id: featured.id } })} style={[styles.hero, { backgroundColor: theme.pink }]}>
      <Text style={{ color: theme.onPink, fontSize: 11, letterSpacing: 2 }}>TODAY&apos;S SHADOWING</Text><Text style={[styles.heroTitle, { color: theme.onPink }]}>A little more{ '\n' }curiosity.</Text><Text style={{ color: theme.onPink, fontSize: 16, marginTop: 16 }}>把好奇心，说出来。</Text><View style={styles.wave}>{[14, 26, 42, 30, 53, 21, 35, 48, 20, 36, 26, 43].map((height, i) => <View key={i} style={{ height, width: 4, backgroundColor: theme.onPink, borderRadius: 2 }} />)}<Ionicons name="arrow-forward" color={theme.onPink} size={28} style={{ marginLeft: 'auto' }} /></View>
    </Pressable>
    <View style={speakingStyles.chips}>{speakingCategories.map(item => <Pressable key={item} onPress={() => setCategory(item)} accessibilityRole="button" accessibilityState={{ selected: item === category }} style={[speakingStyles.chip, { borderColor: theme.border, backgroundColor: category === item ? theme.accentSoft : theme.bg }]}><Text style={{ color: category === item ? theme.accent : theme.textMuted }}>{item}</Text></Pressable>)}</View>
    <SpeakingStatus loading={library.loading} error={library.error || library.catalogError} retry={library.refresh} />
    {matches.map(item => <SpeakingMaterialRow key={item.id} material={item} position={library.store.positions[item.id]} onPress={() => router.push({ pathname: '/speaking/material', params: { id: item.id } })} />)}
    {!matches.length ? <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>没有匹配的素材，请换个关键词或分类。</Text> : null}
    <Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 20 }]}>原创示范音与电影对白，听懂一句，再开口跟读。也可导入自己的音视频。</Text>
  </ScrollView></View>;
}
const styles = StyleSheet.create({ hero: { padding: 24, borderRadius: 3 }, heroTitle: { fontFamily: fonts.display, fontSize: 49, lineHeight: 51, marginTop: 24 }, wave: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 56, marginTop: 26 } });
