import { EditorialReadBadge } from '@/features/editorial/EditorialReadBadge';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContinuePracticeCard } from '@/features/practice/ContinuePracticeCard';
import { getApiBaseUrl } from '@/api/client';

import { SectionHeader } from '@/components/ui';
import { fonts, weight } from '@/constants/theme';
import { BrandHeader, PageHeading, TouchCard } from '@/components/brand';
import { useAppTheme } from '@/context/ThemeContext';

import {
  editorialHasOriginalAudio,
  getEditorialSection,
  searchEditorialArticles,
  type EditorialArticle,
} from './catalog';
import { EditorialImage } from './EditorialImage';
import { FeaturedLibrary } from './FeaturedLibrary';
import { PUBLICATION_LOGOS } from './publicationLogo';
import {
  refreshRemoteEditorialCatalog,
  useRemoteEditorialCatalogVersion,
} from './remoteCatalog';

const PAGE_SIZE = 24;
const KNOWN_SOURCES = ['The Economist', 'The New Yorker', 'The Atlantic', 'WIRED'];
let imageHostWakeRequested = false;

export function EditorialHomeScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('全部刊物');
  const [year, setYear] = useState('全部年份');
  const [topic, setTopic] = useState('全部');
  const { width } = useWindowDimensions();
  const wide = width >= 1100;
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const catalogVersion = useRemoteEditorialCatalogVersion();

  useFocusEffect(useCallback(() => {
    void refreshRemoteEditorialCatalog().catch(() => undefined);
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshRemoteEditorialCatalog().catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(false);
    try {
      await refreshRemoteEditorialCatalog();
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (imageHostWakeRequested) return;
    let baseUrl: string;
    try {
      baseUrl = getApiBaseUrl();
    } catch {
      return;
    }
    imageHostWakeRequested = true;
    // EPUB covers are served by the API. Wake an idle host while the reader
    // browses locally bundled issue dates, before the first cover request.
    void fetch(`${baseUrl}/health/live`).catch(() => undefined);
  }, []);

  const hero = getEditorialSection('today')[0];
  const searchResults = useMemo(
    () => searchEditorialArticles(query).filter((article) =>
      (article.id !== hero?.id || query.trim().length > 0)
      && (source === '全部刊物' || article.source === source)
      && (topic === '全部' || article.category === topic)
      && (year === '全部年份' || (article.issueDate ?? article.publishedAt).startsWith(year))),
    [query, source, year, topic, catalogVersion, hero?.id],
  );
  const years = useMemo(() => ['全部年份', ...new Set(getEditorialSection('featured')
    .map((article) => (article.issueDate ?? article.publishedAt).slice(0, 4)).filter(value => /^\d{4}$/u.test(value)).sort().reverse())], [catalogVersion]);
  const sources = useMemo(() => ['全部刊物', ...new Set([
    ...KNOWN_SOURCES,
    ...searchEditorialArticles('').map((article) => article.source),
  ])], [catalogVersion]);
  const topics = useMemo(() => ['全部', ...new Set(searchEditorialArticles('').map(article => article.category))], [catalogVersion]);

  const openOverview = (article: EditorialArticle) => {
    router.push({
      pathname: '/editorial/[id]',
      params: { id: article.id },
    } as unknown as Parameters<typeof router.push>[0]);
  };

  const openSearch = () => {
    setSearchOpen((open) => !open);
    setPage(0);
    setSource('全部刊物');
    setYear('全部年份');
  };

  const clearSearch = () => {
    setQuery('');
    setPage(0);
  };

  const showSearchResults = searchOpen && query.trim().length > 0;
  const resultCount = searchResults.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / PAGE_SIZE));
  const changePage = (next: number) => {
    setPage(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const filters = (
    <View style={styles.filters}>
      {[{ label: '主题', values: topics, selected: topic, change: setTopic },
        { label: '外刊', values: sources, selected: source, change: setSource },
        { label: '年份', values: years, selected: year, change: setYear }].map((filter) => (
        <View key={filter.label} style={styles.filterRow}>
          <Text style={[styles.filterLabel, { color: theme.text, borderRightColor: theme.border }]}>{filter.label}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterOptions}>
          {filter.values.map((value) => (
            <TouchableOpacity key={value} accessibilityRole="button" accessibilityLabel={`筛选${value}`}
              accessibilityState={{ selected: filter.selected === value }}
              onPress={() => { filter.change(value); setPage(0); }}
              style={[styles.filter, { backgroundColor: filter.selected === value ? theme.accentSoft : theme.bg }]}>
              <Text style={{ color: filter.selected === value ? theme.blue : theme.textMuted }}>{value}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        </View>
      ))}
      <Text style={{ color: theme.textMuted }}>共 {resultCount} 篇</Text>
    </View>
  );
  const pagination = resultCount > PAGE_SIZE ? (
    <View style={styles.pagination}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="发现文章上一页" disabled={page === 0}
        onPress={() => changePage(page - 1)} style={styles.pageButton}>
        <Text style={{ color: page === 0 ? theme.textMuted : theme.blue }}>上一页</Text>
      </TouchableOpacity>
      <Text style={{ color: theme.textMuted }}>发现文章 · 第 {page + 1} 页 / 共 {pageCount} 页</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="发现文章下一页" disabled={page + 1 >= pageCount}
        onPress={() => changePage(page + 1)} style={styles.pageButton}>
        <Text style={{ color: page + 1 >= pageCount ? theme.textMuted : theme.blue }}>下一页</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <BrandHeader action={searchOpen ? 'close' : 'search-outline'} label="搜索平台外刊" onPress={openSearch} />

      {searchOpen ? (
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={(value) => { setQuery(value); setPage(0); }}
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
        ref={scrollRef}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={theme.blue} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}>
        <PageHeading title="外刊" description="读英语，也读世界。" />
        {refreshError ? <Text style={{ color: theme.textMuted }}>暂时无法更新外刊，已显示上次内容</Text> : null}
        <View style={wide ? styles.wideColumns : undefined}>
        <View style={wide ? styles.heroColumn : undefined}>
          {hero ? <HeroCard article={hero} theme={theme} onPress={() => openOverview(hero)} /> : null}
          <ContinuePracticeCard />
        </View>
        <View style={wide ? styles.discoveryColumn : undefined}>
        {showSearchResults ? (
          <>
            <SectionHeader title="搜索结果" theme={theme} />
            {filters}
            {searchResults.length > 0 ? (
              <View style={styles.resultsList}>
                {searchResults.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((article) => (
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
            {pagination}
          </>
        ) : (
          <>
            <SectionHeader title="发现文章" theme={theme} />
            {filters}
            <View style={styles.resultsList}>
              {searchResults.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(article => <ArticleCard key={article.id} article={article} theme={theme} onPress={() => openOverview(article)} />)}
              {!searchResults.length ? <Text style={{ color: theme.textMuted, paddingVertical: 24 }}>当前筛选暂无文章，试试其他主题或外刊。</Text> : null}
            </View>
            {pagination}
            <FeaturedLibrary
              key={`${topic}:${source}:${year}`}
              filterTopic={topic} filterSource={source} filterYear={year}
              renderArticle={(article) => (
                <ArticleCard key={article.id} article={article} theme={theme}
                  onPress={() => openOverview(article)} />
              )}
              onNavigate={() => scrollRef.current?.scrollTo({ y: 0, animated: false })}
            />

          </>
        )}
        </View>
        </View>
      </ScrollView>
    </View>
  );
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
    <TouchCard
      onPress={onPress}
      accessibilityLabel={`${article.titleZh}，查看文章概述`}
      style={[styles.heroCard, { backgroundColor: theme.pink }]}>
      <Text style={[styles.heroSource, { color: theme.onPink }]}>每日精选</Text>
      <Text style={[styles.heroTitle, { color: theme.onPink }]}>{article.titleEn}</Text>
      <EditorialImage uri={article.image} fallbackSource={PUBLICATION_LOGOS[article.source]} style={styles.heroImage} />
      <View style={styles.heroMetaRow}><Text style={[styles.heroSource, { color: theme.onPink }]}>{article.source}</Text>
        <Text style={[styles.heroMeta, { color: theme.onPink }]}>{article.minutes} 分钟</Text>
        <View style={[styles.heroArrow, { backgroundColor: '#B53720' }]}><Ionicons name="arrow-forward" size={26} color="#FFFFFF" /></View>
      </View>
      <Text style={[styles.heroTitleZh, { color: theme.onPink }]}>{article.titleZh}</Text>
      <View style={[styles.heroBottom, { borderTopColor: '#9C5A6D' }]}><Text style={[styles.heroMeta, { color: theme.onPink }]}>{article.category}</Text>
        <Text style={[styles.heroMeta, { color: theme.onPink }]}>{article.wordCount.toLocaleString()} 词</Text></View>
    </TouchCard>
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
      <EditorialImage uri={article.image} fallbackSource={PUBLICATION_LOGOS[article.source]}
        style={styles.articleImage} priority="high" />
      <View style={styles.articleInfo}>
        <EditorialReadBadge articleId={article.id} />
        <Text style={[styles.articleTitle, { color: theme.text }]} numberOfLines={2}>{article.titleZh}</Text>
        <Text style={[styles.articleSource, { color: theme.textMuted }]} numberOfLines={1}>{article.source} · {article.category}</Text>
        <Text style={[styles.articleSource, { color: theme.textMuted }]}>{article.issueDate ?? article.publishedAt}</Text>
        {editorialHasOriginalAudio(article) ? <Text style={[styles.articleSource, { color: theme.blue }]}>原刊录音</Text> : null}
        <Text style={[styles.articleMeta, { color: theme.textSecondary }]}>{article.level} · {article.wordCount} 词 · {article.minutes} 分钟</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 10, marginBottom: 16 },
  filter: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginRight: 6 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  pageButton: { padding: 12 },
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
  content: { paddingHorizontal: 24, paddingTop: 12, maxWidth: 1240, width: '100%', alignSelf: 'center' },
  wideColumns: { flexDirection: 'row', gap: 36, alignItems: 'flex-start' },
  heroColumn: { flex: 1, minWidth: 0 },
  discoveryColumn: { flex: 1.15, minWidth: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterLabel: { width: 44, flexShrink: 0, borderRightWidth: StyleSheet.hairlineWidth, fontSize: 12 },
  filterOptions: { flex: 1, minWidth: 0 },
  heroCard: { borderRadius: 2, padding: 22, marginBottom: 30, overflow: 'hidden' },
  heroImage: { height: 210, width: '100%', marginTop: 20 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15, paddingRight: 50 },
  heroArrow: { position: 'absolute', right: -6, top: -39, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#E59EB4' },
  heroTitleZh: { fontSize: 18, lineHeight: 28, marginTop: 12 },
  heroBottom: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 16, flexDirection: 'row', justifyContent: 'space-between' },
  heroShade: { backgroundColor: 'rgba(0,0,0,0.32)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroOverlay: { bottom: 16, left: 16, position: 'absolute', right: 16 },
  heroSource: { fontSize: 12 },
  heroTitle: { fontFamily: fonts.display, fontSize: 40, lineHeight: 43, marginTop: 12 },
  heroMeta: { fontSize: 11 },
  resultsList: { gap: 10, marginBottom: 22 },
  articleCard: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 14, paddingVertical: 16 },
  articleImage: { borderRadius: 2, height: 104, width: 82 },
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
