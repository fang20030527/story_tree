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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContinuePracticeCard } from '@/features/practice/ContinuePracticeCard';
import { getApiBaseUrl } from '@/api/client';

import { SectionHeader } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

import {
  getEditorialSection,
  searchEditorialArticles,
  type EditorialArticle,
} from './catalog';
import { EditorialImage } from './EditorialImage';
import { FeaturedLibrary } from './FeaturedLibrary';
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

  const searchResults = useMemo(
    () => searchEditorialArticles(query).filter((article) =>
      (source === '全部刊物' || article.source === source)
      && (year === '全部年份' || article.issueDate?.startsWith(year))),
    [query, source, year, catalogVersion],
  );
  const years = useMemo(() => ['全部年份', ...new Set(getEditorialSection('featured')
    .flatMap((article) => article.issueDate ? [article.issueDate.slice(0, 4)] : []).sort().reverse())], [catalogVersion]);
  const sources = useMemo(() => ['全部刊物', ...new Set([
    ...KNOWN_SOURCES,
    ...searchEditorialArticles('').map((article) => article.source),
  ])], [catalogVersion]);

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

  const hero = getEditorialSection('today')[0];
  const showSearchResults = searchOpen && query.trim().length > 0;
  const resultCount = searchResults.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / PAGE_SIZE));
  const changePage = (next: number) => {
    setPage(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const filters = (
    <View style={styles.filters}>
      {[{ values: sources, selected: source, change: setSource },
        { values: years, selected: year, change: setYear }].map((filter, index) => (
        <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false}>
          {filter.values.map((value) => (
            <TouchableOpacity key={value} accessibilityRole="button" accessibilityLabel={`筛选${value}`}
              accessibilityState={{ selected: filter.selected === value }}
              onPress={() => { filter.change(value); setPage(0); }}
              style={[styles.filter, { backgroundColor: filter.selected === value ? theme.surfaceAlt : theme.bg }]}>
              <Text style={{ color: filter.selected === value ? theme.blue : theme.textMuted }}>{value}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ))}
      <Text style={{ color: theme.textMuted }}>共 {resultCount} 篇</Text>
    </View>
  );
  const pagination = resultCount > PAGE_SIZE ? (
    <View style={styles.pagination}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="上一页" disabled={page === 0}
        onPress={() => changePage(page - 1)} style={styles.pageButton}>
        <Text style={{ color: page === 0 ? theme.textMuted : theme.blue }}>上一页</Text>
      </TouchableOpacity>
      <Text style={{ color: theme.textMuted }}>第 {page + 1} / {pageCount} 页</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="下一页" disabled={page + 1 >= pageCount}
        onPress={() => changePage(page + 1)} style={styles.pageButton}>
        <Text style={{ color: page + 1 >= pageCount ? theme.textMuted : theme.blue }}>下一页</Text>
      </TouchableOpacity>
    </View>
  ) : null;

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
        <ContinuePracticeCard />
        {refreshError ? <Text style={{ color: theme.textMuted }}>暂时无法更新外刊，已显示上次内容</Text> : null}
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

            <FeaturedLibrary
              renderArticle={(article) => (
                <ArticleCard key={article.id} article={article} theme={theme}
                  onPress={() => openOverview(article)} />
              )}
              onNavigate={() => scrollRef.current?.scrollTo({ y: 0, animated: false })}
            />

          </>
        )}
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
          <EditorialReadBadge articleId={article.id} />
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
      <EditorialImage uri={article.image} style={styles.articleImage} priority="high" />
      <View style={styles.articleInfo}>
        <EditorialReadBadge articleId={article.id} />
        <Text style={[styles.articleTitle, { color: theme.text }]} numberOfLines={2}>{article.titleZh}</Text>
        <Text style={[styles.articleSource, { color: theme.textMuted }]} numberOfLines={1}>{article.source} · {article.category}</Text>
        {article.issueDate ? <Text style={[styles.articleSource, { color: theme.textMuted }]}>{article.issueDate}</Text> : null}
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
