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
import { flyToTab } from '@/components/absorb';
import { Comet, EnterOnce, ObservationWindow } from '@/components/cosmos';
import { PressFeedback } from '@/components/motion';
import { radius, typeScale, weight } from '@/constants/theme';
import { BrandHeader, PageHeading, TouchCard } from '@/components/brand';
import { useAppTheme } from '@/context/ThemeContext';
import { useModeAccent } from '@/context/modeAccent';
import { isEditorialArticleShelved, setEditorialArticleShelved } from '@/features/shelf/editorialShelfStorage';

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
  const [moreFilters, setMoreFilters] = useState(false);
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
  const extraFilterCount = (source !== '全部刊物' ? 1 : 0) + (year !== '全部年份' ? 1 : 0);
  const filterRow = (filter: { label: string; values: string[]; selected: string; change: (value: string) => void }) => (
    <ScrollView key={filter.label} horizontal showsHorizontalScrollIndicator={false} style={styles.filterOptions} contentContainerStyle={styles.filterContent}>
      {filter.values.map((value) => (
        <TouchableOpacity key={value} accessibilityRole="button" accessibilityLabel={`筛选${value}`}
          accessibilityState={{ selected: filter.selected === value }}
          onPress={() => { filter.change(value); setPage(0); }}
          style={[styles.filter, { backgroundColor: filter.selected === value ? theme.text : 'transparent' }]}>
          <Text style={{ color: filter.selected === value ? theme.bg : theme.textSecondary, fontSize: 14, fontWeight: weight(filter.selected === value ? 'semibold' : 'regular') }}>{value}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
  const filters = (
    <View style={styles.filters}>
      {filterRow({ label: '主题', values: topics, selected: topic, change: setTopic })}
      {moreFilters ? <View style={[styles.morePanel, { backgroundColor: theme.surfaceAlt }]}>
        <Text style={[styles.moreLabel, { color: theme.textMuted }]}>刊物</Text>
        {filterRow({ label: '外刊', values: sources, selected: source, change: setSource })}
        <Text style={[styles.moreLabel, { color: theme.textMuted }]}>年份</Text>
        {filterRow({ label: '年份', values: years, selected: year, change: setYear })}
      </View> : null}
      <Text style={[styles.count, { color: theme.textMuted }]}>共 {resultCount} 篇</Text>
    </View>
  );
  const filterToggle = (
    <PressFeedback accessibilityRole="button" accessibilityLabel={moreFilters ? '收起刊物与年份筛选' : '展开刊物与年份筛选'} accessibilityState={{ expanded: moreFilters }}
      onPress={() => setMoreFilters((open) => !open)} style={[styles.filterToggle, { backgroundColor: moreFilters || extraFilterCount ? theme.surfaceAlt : 'transparent' }]} hitSlop={6}>
      <Ionicons name="options-outline" size={15} color={theme.textSecondary} />
      <Text style={{ color: theme.textSecondary, fontSize: 13 }}>刊物与年份</Text>
      {extraFilterCount ? <View style={[styles.filterCount, { backgroundColor: theme.text }]}><Text style={{ color: theme.bg, fontSize: 11, fontWeight: weight('semibold') }}>{extraFilterCount}</Text></View> : null}
    </PressFeedback>
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
      <BrandHeader modeSwitch action={searchOpen ? 'close' : 'search-outline'} label="搜索平台外刊" onPress={openSearch} />

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
            <View style={styles.sectionRow}><SectionHeader title="搜索结果" theme={theme} />{filterToggle}</View>
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
                <EnterOnce><ObservationWindow size={170} /></EnterOnce>
                <Text style={[styles.noResultsText, { color: theme.text }]}>没有找到相关外刊</Text>
                <Text style={[styles.noResultsHint, { color: theme.textSecondary }]}>换个关键词，或者试试英文原词。</Text>
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
            <View style={styles.sectionRow}><SectionHeader title="发现文章" theme={theme} />{filterToggle}</View>
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
  const accent = useModeAccent();
  const [saved, setSaved] = useState(false);
  const saveButton = useRef<View>(null);
  useEffect(() => {
    let current = true;
    void isEditorialArticleShelved(article.id).then((value) => { if (current) setSaved(value); }).catch(() => undefined);
    return () => { current = false; };
  }, [article.id]);
  // 收进书架：书签填满，小卡片沿弧线飞进「书架」，图标轻跳并出现角标。
  const toggleSaved = () => {
    const next = !saved;
    setSaved(next);
    void setEditorialArticleShelved(article.id, next).then(() => {
      if (next) void flyToTab(saveButton.current, 'shelf', typeof article.image === 'string' && article.image ? { uri: article.image } : PUBLICATION_LOGOS[article.source]);
    }).catch(() => setSaved(!next));
  };
  return (
    <View style={styles.heroCard}>
      <TouchCard
        onPress={onPress}
        accessibilityLabel={`${article.titleZh}，查看文章概述`}
        style={styles.heroPress}>
        <View>
          <EditorialImage uri={article.image} fallbackSource={PUBLICATION_LOGOS[article.source]} style={styles.heroImage} />
          <View style={[styles.flag, { backgroundColor: theme.bg }]}>
            <EnterOnce dx={-12} dy={4.4} delay={120}><Comet size={30} /></EnterOnce>
            <Text style={[styles.flagText, { color: theme.text }]}>每日精选</Text>
          </View>
        </View>
        <View style={styles.heroMetaRow}>
          <Text style={[styles.heroSource, { color: theme.textSecondary }]}>{article.source}</Text>
          <View style={styles.metaItem}><Ionicons name="time-outline" size={13} color={theme.textMuted} /><Text style={[styles.heroMeta, { color: theme.textMuted }]}>{article.minutes} 分钟</Text></View>
          <View style={styles.metaItem}><Ionicons name="reorder-three-outline" size={14} color={theme.textMuted} /><Text style={[styles.heroMeta, { color: theme.textMuted }]}>{article.wordCount.toLocaleString()} 词</Text></View>
        </View>
        <Text style={[styles.heroTitle, { color: theme.text }]}>{article.titleEn}</Text>
        <Text style={[styles.heroTitleZh, { color: theme.textSecondary }]}>{article.titleZh}</Text>
        <View style={styles.heroFoot}>
          <View style={[styles.tag, { backgroundColor: theme.surfaceAlt }]}><Text style={[styles.tagText, { color: theme.textSecondary }]}>{article.category}</Text></View>
          {article.level ? <View style={[styles.tag, { backgroundColor: theme.surfaceAlt }]}><Text style={[styles.tagText, { color: theme.textSecondary }]}>{article.level}</Text></View> : null}
          <View style={[styles.readPill, { backgroundColor: theme.accent }]}><Text style={[styles.readPillText, { color: theme.accentText }]}>开始阅读</Text><Ionicons name="arrow-forward" size={14} color={theme.accentText} /></View>
        </View>
      </TouchCard>
      <PressFeedback ref={saveButton} accessibilityRole="button" accessibilityLabel={saved ? '已收进书架，再点取消' : '收进书架'} accessibilityState={{ selected: saved }}
        onPress={toggleSaved} containerStyle={styles.saveWrap} style={[styles.save, { backgroundColor: theme.bg }]} hitSlop={6}>
        <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={18} color={saved ? accent.ink : theme.text} />
      </PressFeedback>
    </View>
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
  const accent = useModeAccent();
  return (
    <PressFeedback
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${article.titleZh}，查看文章概述`}
      style={styles.articleCard}>
      <EditorialImage uri={article.image} fallbackSource={PUBLICATION_LOGOS[article.source]}
        style={styles.articleImage} priority="high" />
      <View style={styles.articleInfo}>
        <EditorialReadBadge articleId={article.id} />
        <Text style={[styles.articleTitle, { color: theme.text }]} numberOfLines={2}>{article.titleZh}</Text>
        <Text style={[styles.articleSource, { color: theme.textMuted }]} numberOfLines={1}>{article.source} · {article.issueDate ?? article.publishedAt}</Text>
        <View style={styles.articleTags}>
          <Text style={[styles.articleMeta, { color: theme.textMuted }]}>{article.category}</Text>
          {article.level ? <Text style={[styles.articleMeta, { color: theme.textMuted }]}>{article.level}</Text> : null}
          <View style={styles.metaItem}><Ionicons name="time-outline" size={12} color={theme.textMuted} /><Text style={[styles.articleMeta, { color: theme.textMuted }]}>{article.minutes} 分钟</Text></View>
          {editorialHasOriginalAudio(article) ? <View style={styles.metaItem}><Ionicons name="headset-outline" size={12} color={accent.ink} /><Text style={[styles.articleMeta, { color: accent.ink, fontWeight: weight('semibold') }]}>原刊录音</Text></View> : null}
        </View>
      </View>
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 10, marginBottom: 12 },
  filter: { paddingHorizontal: 13, minHeight: 32, justifyContent: 'center', borderRadius: radius.pill, marginRight: 2 },
  filterContent: { paddingRight: 8 },
  count: { fontSize: 12, fontVariant: ['tabular-nums'] },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  filterToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 10, borderRadius: radius.pill },
  filterCount: { minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  morePanel: { borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: 10, gap: 6 },
  moreLabel: { fontSize: 12, marginLeft: 4 },
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
  filterOptions: { flexGrow: 0, minWidth: 0 },
  heroCard: { marginBottom: 30 },
  heroPress: { gap: 10 },
  heroImage: { height: 216, width: '100%', borderRadius: 18 },
  flag: { position: 'absolute', left: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 3, height: 28, paddingLeft: 6, paddingRight: 11, borderRadius: radius.pill, opacity: 0.94 },
  flagText: { fontSize: 12.5, fontWeight: weight('semibold') },
  saveWrap: { position: 'absolute', right: 10, top: 10 },
  save: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: 0.94 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  heroSource: { fontSize: 12.5, fontWeight: weight('semibold') },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  tag: { minHeight: 26, paddingHorizontal: 10, borderRadius: radius.tag, justifyContent: 'center' },
  tagText: { fontSize: 12.5 },
  readPill: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingLeft: 14, paddingRight: 12, borderRadius: radius.pill },
  readPillText: { fontSize: 13.5, fontWeight: weight('semibold') },
  heroTitleZh: { fontSize: 15, lineHeight: 22, marginTop: -2 },
  heroShade: { backgroundColor: 'rgba(0,0,0,0.32)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroOverlay: { bottom: 16, left: 16, position: 'absolute', right: 16 },
  heroTitle: { fontFamily: 'HeidongReadingMedium', fontSize: 23, lineHeight: 30 },
  heroMeta: { fontSize: 12.5, fontVariant: ['tabular-nums'] },
  resultsList: { gap: 4, marginBottom: 22, marginHorizontal: -8 },
  articleCard: { alignItems: 'flex-start', flexDirection: 'row', gap: 14, padding: 8, borderRadius: 16 },
  articleImage: { borderRadius: radius.content, height: 76, width: 76 },
  articleInfo: { flex: 1, minWidth: 0 },
  articleTitle: { ...typeScale.cardTitle },
  articleSource: { fontSize: 12.5, marginTop: 3 },
  articleTags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, marginTop: 4 },
  articleMeta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  backToSections: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 3, marginBottom: 18 },
  backToSectionsText: { fontSize: 13, fontWeight: weight('medium') },
  noResults: { alignItems: 'center', gap: 6, paddingTop: 40 },
  noResultsText: { fontSize: 17, fontWeight: weight('semibold') },
  noResultsHint: { fontSize: 13.5, marginBottom: 6 },
  clearSearchText: { fontSize: 13, fontWeight: weight('medium') },
});
