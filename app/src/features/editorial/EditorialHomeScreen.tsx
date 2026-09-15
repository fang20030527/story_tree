import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContinuePracticeCard } from '@/features/practice/ContinuePracticeCard';

import { SectionHeader } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

import {
  getEditorialSection,
  searchEditorialArticles,
  type EditorialArticle,
  type EditorialSection,
} from './catalog';
import { EditorialImage } from './EditorialImage';

export function EditorialHomeScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sectionView, setSectionView] = useState<EditorialSection | null>(null);

  const searchResults = useMemo(
    () => searchEditorialArticles(query),
    [query],
  );
  const sectionResults = useMemo(
    () => (sectionView ? getEditorialSection(sectionView) : []),
    [sectionView],
  );

  const openOverview = (article: EditorialArticle) => {
    router.push({
      pathname: '/editorial/[id]',
      params: { id: article.id },
    } as unknown as Parameters<typeof router.push>[0]);
  };

  const openSearch = () => {
    setSearchOpen((open) => !open);
    setSectionView(null);
  };

  const clearSearch = () => {
    setQuery('');
  };

  const hero = getEditorialSection('today')[0];
  const featured = getEditorialSection('featured');
  const news = getEditorialSection('daily');
  const kids = getEditorialSection('kids');
  const showSearchResults = searchOpen && query.trim().length > 0;
  const showSection = !showSearchResults && sectionView !== null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerSide} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>外刊</Text>
        <TouchableOpacity
          onPress={openSearch}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="搜索平台外刊">
          <Ionicons
            name={searchOpen ? 'close' : 'search-outline'}
            size={22}
            color={theme.text}
          />
        </TouchableOpacity>
      </View>

      {searchOpen ? (
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholder="搜索中英文标题、来源或分类"
            placeholderTextColor={theme.textMuted}
            accessibilityLabel="搜索中英文标题、来源或分类"
            style={[styles.searchInput, { color: theme.text }]}
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={clearSearch}
              accessibilityRole="button"
              accessibilityLabel="清除搜索">
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}>
        <ContinuePracticeCard />
        {showSearchResults ? (
          <>
            <SectionHeader title="搜索结果" theme={theme} />
            {searchResults.length > 0 ? (
              <View style={styles.resultsList}>
                {searchResults.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    theme={theme}
                    onPress={() => openOverview(article)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.noResults}>
                <Ionicons name="search-outline" size={30} color={theme.textMuted} />
                <Text style={[styles.noResultsText, { color: theme.textMuted }]}>没有找到相关外刊</Text>
                <TouchableOpacity
                  onPress={clearSearch}
                  accessibilityRole="button"
                  accessibilityLabel="清除搜索">
                  <Text style={[styles.clearSearchText, { color: theme.blue }]}>清除搜索</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : showSection ? (
          <>
            <TouchableOpacity
              onPress={() => setSectionView(null)}
              accessibilityRole="button"
              accessibilityLabel="返回全部栏目"
              style={styles.backToSections}>
              <Ionicons name="chevron-back" size={17} color={theme.blue} />
              <Text style={[styles.backToSectionsText, { color: theme.blue }]}>返回全部栏目</Text>
            </TouchableOpacity>
            <SectionHeader
              title={sectionTitle(sectionView!)}
              theme={theme}
            />
            <View style={styles.resultsList}>
              {sectionResults.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  theme={theme}
                  onPress={() => openOverview(article)}
                />
              ))}
            </View>
          </>
        ) : (
          <>
            {hero ? (
              <>
                <SectionHeader title="今日精选" theme={theme} />
                <HeroCard
                  article={hero}
                  theme={theme}
                  onPress={() => openOverview(hero)}
                />
              </>
            ) : null}

            <SectionHeader
              title="精选外刊"
              theme={theme}
              moreLabel="更多"
              onMore={() => setSectionView('featured')}
            />
            <View style={styles.resultsList}>
              {featured.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  theme={theme}
                  onPress={() => openOverview(article)}
                />
              ))}
            </View>

            <SectionHeader
              title="每日快讯"
              theme={theme}
              moreLabel="更多"
              onMore={() => setSectionView('daily')}
            />
            <View style={styles.resultsList}>
              {news.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  theme={theme}
                  onPress={() => openOverview(article)}
                />
              ))}
            </View>

            <SectionHeader
              title="Kid News"
              theme={theme}
              moreLabel="更多"
              onMore={() => setSectionView('kids')}
            />
            <View style={styles.resultsList}>
              {kids.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  theme={theme}
                  onPress={() => openOverview(article)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function sectionTitle(section: EditorialSection): string {
  switch (section) {
    case 'today':
      return '今日精选';
    case 'featured':
      return '精选外刊';
    case 'daily':
      return '每日快讯';
    case 'kids':
      return 'Kid News';
  }
}

function HeroCard({
  article,
  theme,
  onPress,
}: {
  article: EditorialArticle;
  theme: ReturnType<typeof useAppTheme>['theme'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel={`${article.titleZh}，查看文章概述`}
      style={styles.heroCard}>
      <EditorialImage uri={article.image} style={styles.heroImage}>
        <View style={styles.heroShade} />
        <View style={styles.heroOverlay}>
          <Text style={styles.heroSource}>{article.source} · {article.category}</Text>
          <Text style={styles.heroTitle}>{article.titleZh}</Text>
          <Text style={styles.heroMeta}>{article.level} · {article.wordCount} 词 · {article.minutes} 分钟</Text>
        </View>
      </EditorialImage>
    </TouchableOpacity>
  );
}

function ArticleCard({
  article,
  theme,
  onPress,
}: {
  article: EditorialArticle;
  theme: ReturnType<typeof useAppTheme>['theme'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={`${article.titleZh}，查看文章概述`}
      style={[styles.articleCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <EditorialImage uri={article.image} style={styles.articleImage} />
      <View style={styles.articleInfo}>
        <Text style={[styles.articleTitle, { color: theme.text }]} numberOfLines={2}>{article.titleZh}</Text>
        <Text style={[styles.articleSource, { color: theme.textMuted }]} numberOfLines={1}>{article.source} · {article.category}</Text>
        <Text style={[styles.articleMeta, { color: theme.textSecondary }]}>{article.level} · {article.wordCount} 词 · {article.minutes} 分钟</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  headerSide: { width: 22 },
  headerTitle: { fontSize: 19, fontWeight: weight('bold') },
  searchWrap: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  heroCard: { borderRadius: 16, marginBottom: 26, overflow: 'hidden' },
  heroImage: { height: 230, width: '100%' },
  heroShade: { backgroundColor: 'rgba(0,0,0,0.32)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroOverlay: { bottom: 16, left: 16, position: 'absolute', right: 16 },
  heroSource: { color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: weight('medium') },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: weight('bold'), lineHeight: 30, marginTop: 7 },
  heroMeta: { color: 'rgba(255,255,255,0.86)', fontSize: 12, marginTop: 9 },
  resultsList: { gap: 10, marginBottom: 22 },
  articleCard: { alignItems: 'center', borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, padding: 10 },
  articleImage: { borderRadius: 9, height: 82, width: 92 },
  articleInfo: { flex: 1 },
  articleTitle: { fontSize: 15, fontWeight: weight('semibold'), lineHeight: 21 },
  articleSource: { fontSize: 11, marginTop: 5 },
  articleMeta: { fontSize: 11, marginTop: 5 },
  backToSections: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 3, marginBottom: 18 },
  backToSectionsText: { fontSize: 13, fontWeight: weight('medium') },
  noResults: { alignItems: 'center', gap: 9, paddingTop: 90 },
  noResultsText: { fontSize: 14 },
  clearSearchText: { fontSize: 13, fontWeight: weight('medium') },
});
