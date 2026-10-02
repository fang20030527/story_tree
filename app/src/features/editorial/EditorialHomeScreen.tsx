import { EditorialReadBadge } from '@/features/editorial/EditorialReadBadge';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useLayoutWidth } from '@/components/useLayoutWidth';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContinuePracticeCard } from '@/features/practice/ContinuePracticeCard';
import { getApiBaseUrl } from '@/api/client';

import { SectionHeader } from '@/components/ui';
import { fonts, radius, weight } from '@/constants/theme';
import { BrandHeader, PageHeading, Spine, TouchCard } from '@/components/brand';
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
  const width = useLayoutWidth();
  const wide = width >= 1100;
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const featuredLayout = useRef<{ columns: number | null; discovery: number | null; section: number | null }>({
    columns: null, discovery: null, section: null,
  });
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
  const showFeaturedSection = () => {
    // 等分类内容更新后再定位，三个偏移同时适配单列和双列布局。
    requestAnimationFrame(() => {
      const { columns, discovery, section } = featuredLayout.current;
      if (columns === null || discovery === null || section === null) return;
      scrollRef.current?.scrollTo({ y: columns + discovery + section, animated: false });
    });
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
              style={[styles.filter, { backgroundColor: filter.selected === value ? theme.text : 'transparent' }]}>
              <Text style={{ color: filter.selected === value ? theme.bg : theme.textSecondary, fontSize: 13 }}>{value}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        </View>
      ))}
      <Text style={[styles.count, { color: theme.textMuted }]}>共 {resultCount} 篇</Text>
    </View>
  );
  const pagination = resultCount > PAGE_SIZE ? (
    <View style={styles.pagination}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="发现文章上一页" disabled={page === 0}
        onPress={() => changePage(page - 1)} style={styles.pageButton}>
        <Text style={{ color: page === 0 ? theme.textMuted : theme.accent }}>上一页</Text>
      </TouchableOpacity>
      <Text style={{ color: theme.textMuted }}>发现文章 · 第 {page + 1} 页 / 共 {pageCount} 页</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="发现文章下一页" disabled={page + 1 >= pageCount}
        onPress={() => changePage(page + 1)} style={styles.pageButton}>
        <Text style={{ color: page + 1 >= pageCount ? theme.textMuted : theme.accent }}>下一页</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <BrandHeader action={searchOpen ? 'close' : 'search-outline'} label="搜索平台外刊" onPress={openSearch} />

      {searchOpen ? (
        <View style={[styles.searchWrap, { backgroundColor: theme.surfaceAlt }]}>
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
        testID="editorial-scroll"
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={theme.accent} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}>
        <PageHeading title="外刊" description="读英语，也读世界。" />
        {refreshError ? <Text style={{ color: theme.textMuted }}>暂时无法更新外刊，已显示上次内容</Text> : null}
        <View testID="editorial-columns" style={wide ? styles.wideColumns : undefined}
          onLayout={(event) => { featuredLayout.current.columns = event.nativeEvent.layout.y; }}>
        <View style={wide ? styles.heroColumn : undefined}>
          {hero ? <HeroCard article={hero} theme={theme} onPress={() => openOverview(hero)} /> : null}
          <ContinuePracticeCard />
        </View>
        <View testID="editorial-discovery" style={wide ? styles.discoveryColumn : undefined}
          onLayout={(event) => { featuredLayout.current.discovery = event.nativeEvent.layout.y; }}>
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
                  <Text style={[styles.clearSearchText, { color: theme.accent }]}>清除搜索</Text>
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
            <View testID="editorial-featured-section" style={{ minHeight: viewportHeight }}
              onLayout={(event) => { featuredLayout.current.section = event.nativeEvent.layout.y; }}>
            <FeaturedLibrary
              key={`${topic}:${source}:${year}`}
              filterTopic={topic} filterSource={source} filterYear={year}
              renderArticle={(article) => (
                <ArticleCard key={article.id} article={article} theme={theme}
                  onPress={() => openOverview(article)} />
              )}
              onNavigate={showFeaturedSection}
            />
            </View>

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
      animateOnPress
      accessibilityLabel={`${article.titleZh}，查看文章概述`}
      style={[styles.heroCard, { borderBottomColor: theme.border }]}>
      <View>
        <EditorialImage uri={article.image} fallbackSource={PUBLICATION_LOGOS[article.source]} style={styles.heroImage} />
        <Spine label="每日精选" style={styles.heroSpine} />
      </View>
      <View style={styles.heroMetaRow}>
        <Text style={[styles.heroMeta, { color: theme.textMuted }]}>{article.source.toUpperCase()}</Text>
        <Text style={[styles.heroMeta, { color: theme.textMuted }]}>{article.minutes} 分钟</Text>
        <Text style={[styles.heroMeta, { color: theme.textMuted }]}>{article.wordCount.toLocaleString()} 词</Text>
      </View>
      <Text style={[styles.heroTitle, { color: theme.text }]}>{article.titleEn}</Text>
      <Text style={[styles.heroTitleZh, { color: theme.textSecondary }]}>{article.titleZh}</Text>
      <View style={styles.heroMetaRow}>
        <Text style={[styles.heroMeta, { color: theme.textMuted }]}>{article.category}</Text>
        <Text style={[styles.heroRead, { color: theme.accent }]}>阅读 →</Text>
      </View>
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
      style={[styles.articleCard, { borderColor: theme.border }]}>
      <EditorialImage uri={article.image} fallbackSource={PUBLICATION_LOGOS[article.source]}
        style={styles.articleImage} priority="high" />
      <View style={styles.articleInfo}>
        <EditorialReadBadge articleId={article.id} />
        <Text style={[styles.articleTitle, { color: theme.text }]} numberOfLines={2}>{article.titleZh}</Text>
        <Text style={[styles.articleSource, { color: theme.textMuted }]} numberOfLines={1}>{article.source.toUpperCase()} · {article.issueDate ?? article.publishedAt}</Text>
        <Text style={[styles.articleCategory, { color: theme.textMuted }]} numberOfLines={1}>{article.category}</Text>
        {editorialHasOriginalAudio(article) ? <Text style={[styles.articleSource, { color: theme.accent }]}>原刊录音</Text> : null}
        <Text style={[styles.articleMeta, { color: theme.textSecondary }]}>{article.level} · {article.wordCount} 词 · {article.minutes} 分钟</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 10, marginBottom: 16 },
  filter: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, marginRight: 4 },
  count: { fontFamily: fonts.label, fontSize: 11 },
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
    borderRadius: radius.pill,
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
  heroCard: { paddingBottom: 22, marginBottom: 26, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  heroImage: { height: 216, width: '100%', borderRadius: radius.content },
  heroSpine: { position: 'absolute', right: 12, top: 14 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  heroTitleZh: { fontSize: 15, lineHeight: 23 },
  heroShade: { backgroundColor: 'rgba(0,0,0,0.32)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroOverlay: { bottom: 16, left: 16, position: 'absolute', right: 16 },
  heroTitle: { fontFamily: fonts.readingMedium, fontSize: 25, lineHeight: 31 },
  heroMeta: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 0.6 },
  heroRead: { fontSize: 13, fontWeight: weight('semibold'), marginLeft: 'auto' },
  resultsList: { gap: 10, marginBottom: 22 },
  articleCard: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 14, paddingVertical: 14 },
  articleImage: { borderRadius: radius.content, height: 92, width: 72 },
  articleInfo: { flex: 1 },
  articleTitle: { fontSize: 15, fontWeight: weight('semibold'), lineHeight: 21 },
  articleSource: { fontFamily: fonts.label, fontSize: 10.5, letterSpacing: 0.3, marginTop: 6 },
  articleCategory: { fontSize: 11, marginTop: 4 },
  articleMeta: { fontFamily: fonts.label, fontSize: 10.5, marginTop: 4 },
  backToSections: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 3, marginBottom: 18 },
  backToSectionsText: { fontSize: 13, fontWeight: weight('medium') },
  noResults: { alignItems: 'center', gap: 9, paddingTop: 90 },
  noResultsText: { fontSize: 14 },
  clearSearchText: { fontSize: 13, fontWeight: weight('medium') },
});
