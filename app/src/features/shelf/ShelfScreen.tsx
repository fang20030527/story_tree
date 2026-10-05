import type { ImportedArticleSummaryDto } from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useLayoutWidth } from '@/components/useLayoutWidth';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BrandHeader, PageHeading, TouchCard } from '@/components/brand';
import { confirmAction } from '@/components/confirm';
import { AbsorbIllustration, BlackHoleLoader, EnterOnce } from '@/components/cosmos';

import { loadRecentViews, type RecentView } from '@/features/library/libraryStorage';
import { getEditorialArticle } from '@/features/editorial/catalog';

import {
  deleteImportedArticle,
  listImportedArticles,
} from '@/api/articles';
import { fonts, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  refreshRemoteEditorialCatalog,
  useRemoteEditorialCatalogVersion,
} from '@/features/editorial/remoteCatalog';

import {
  loadEditorialShelf,
  setEditorialArticleShelved,
  type EditorialShelfEntry,
} from './editorialShelfStorage';
import { ImportSourceGrid } from './ImportSourceGrid';
import {
  filterShelfItems,
  mergeImportedArticles,
  mergeShelfItems,
  type ShelfFilter,
  type ShelfItem,
} from './shelfModel';
import { ShelfRow } from './ShelfRow';

export interface ShelfScreenDependencies {
  loadEditorial: typeof loadEditorialShelf;
  setEditorialShelved: typeof setEditorialArticleShelved;
  listImported: typeof listImportedArticles;
  deleteImported: typeof deleteImportedArticle;
}

type ShelfScreenProps = {
  dependencies?: ShelfScreenDependencies;
};

const defaultDependencies: ShelfScreenDependencies = {
  loadEditorial: loadEditorialShelf,
  setEditorialShelved: setEditorialArticleShelved,
  listImported: listImportedArticles,
  deleteImported: deleteImportedArticle,
};

const FILTERS: readonly { key: ShelfFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'editorial', label: '平台外刊' },
  { key: 'imported', label: '我的导入' },
];

type CloudError = { kind: 'initial' | 'more'; message: string };

export function ShelfScreen({
  dependencies = defaultDependencies,
}: ShelfScreenProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const width = useLayoutWidth();
  const columns = width >= 1100 ? 3 : 2;
  const [recent, setRecent] = useState<RecentView | null>(null);
  const [editorialEntries, setEditorialEntries] = useState<EditorialShelfEntry[]>([]);
  const catalogVersion = useRemoteEditorialCatalogVersion();
  const [importedArticles, setImportedArticles] = useState<ImportedArticleSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [editorialLoading, setEditorialLoading] = useState(true);
  const [initialCloudLoading, setInitialCloudLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const cloudGenerationRef = useRef(0);
  const [cloudError, setCloudError] = useState<CloudError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ShelfFilter>('all');
  const [managing, setManaging] = useState(false);
  const deletingIdsRef = useRef(new Set<string>());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const refreshImported = useCallback(async (
    isActive: () => boolean = () => true,
  ) => {
    const generation = ++cloudGenerationRef.current;
    if (isActive()) {
      setInitialCloudLoading(true);
      setCloudError(null);
      setNextCursor(null);
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
    try {
      const page = await dependencies.listImported({ limit: 30 });
      if (!isActive() || generation !== cloudGenerationRef.current) return;
      setImportedArticles(mergeImportedArticles([], page.items));
      setNextCursor(page.nextCursor);
    } catch {
      if (isActive() && generation === cloudGenerationRef.current) {
        setCloudError({
          kind: 'initial', message: '暂时无法加载我的导入',
        });
      }
    } finally {
      if (isActive() && generation === cloudGenerationRef.current) {
        setInitialCloudLoading(false);
      }
    }
  }, [dependencies]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refreshRemoteEditorialCatalog().catch(() => undefined);
      setEditorialLoading(true);
      void loadRecentViews().then(entries => { if (active) setRecent(entries[0] ?? null); }).catch(() => { if (active) setRecent(null); });
      void dependencies.loadEditorial()
        .then((entries) => { if (active) setEditorialEntries(entries); })
        .catch(() => { if (active) setEditorialEntries([]); })
        .finally(() => { if (active) setEditorialLoading(false); });
      void refreshImported(() => active);
      return () => { active = false; };
    }, [dependencies, refreshImported]),
  );

  const loadMore = useCallback(async () => {
    if (
      !nextCursor || initialCloudLoading || loadingMoreRef.current
    ) return;
    loadingMoreRef.current = true;
    const generation = cloudGenerationRef.current;
    setLoadingMore(true);
    setCloudError(null);
    try {
      const page = await dependencies.listImported({
        limit: 30, cursor: nextCursor,
      });
      if (generation !== cloudGenerationRef.current) return;
      setImportedArticles((current) =>
        mergeImportedArticles(current, page.items));
      setNextCursor(page.nextCursor);
    } catch {
      if (generation === cloudGenerationRef.current) {
        setCloudError({
          kind: 'more', message: '暂时无法加载更多，请重试',
        });
      }
    } finally {
      if (generation === cloudGenerationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [dependencies, initialCloudLoading, nextCursor]);

  const allItems = useMemo(
    () => mergeShelfItems(editorialEntries, importedArticles),
    [editorialEntries, importedArticles, catalogVersion],
  );
  const visibleItems = useMemo(
    () => filterShelfItems(allItems, filter),
    [allItems, filter],
  );

  const openItem = (item: ShelfItem) => {
    if (item.kind === 'editorial') {
      router.push({
        pathname: '/editorial/[id]',
        params: { id: item.id },
      } as unknown as Parameters<typeof router.push>[0]);
    } else {
      router.push({ pathname: '/article-read', params: { id: item.id } });
    }
  };

  const removeEditorial = async (articleId: string) => {
    setActionError(null);
    try {
      await dependencies.setEditorialShelved(articleId, false);
      setEditorialEntries(await dependencies.loadEditorial());
    } catch {
      setActionError('暂时无法更新书架，请重试');
    }
  };

  const permanentlyDelete = async (articleId: string) => {
    if (deletingIdsRef.current.has(articleId)) return;
    deletingIdsRef.current.add(articleId);
    setDeletingIds(new Set(deletingIdsRef.current));
    setActionError(null);
    try {
      await dependencies.deleteImported(articleId);
      setImportedArticles((current) =>
        current.filter(({ id }) => id !== articleId));
    } catch {
      setActionError('删除失败，请重试');
    } finally {
      deletingIdsRef.current.delete(articleId);
      setDeletingIds(new Set(deletingIdsRef.current));
    }
  };

  const performManagementAction = (item: ShelfItem) => {
    if (item.kind === 'editorial') {
      void removeEditorial(item.id);
      return;
    }
    confirmAction({
      title: '永久删除文章？',
      message: '正文和翻译将永久删除，无法恢复；已加入词库的词义和学习进度会保留。',
      confirmLabel: '删除文章',
      destructive: true,
    }, () => { void permanentlyDelete(item.id); });
  };

  const showItemMenu = (item: ShelfItem) => {
    const title = item.kind === 'editorial'
      ? item.article.titleZh
      : item.article.title;
    if (Platform.OS === 'web') {
      // A browser has no action sheet: ask about the one action directly. An import's
      // deletion asks its own confirmation.
      if (item.kind === 'editorial') {
        confirmAction({ title: '移出书架？', message: title, confirmLabel: '移出书架' },
          () => performManagementAction(item));
      } else {
        performManagementAction(item);
      }
      return;
    }
    Alert.alert(
      item.kind === 'editorial' ? '平台外刊' : '我的导入',
      title,
      [
        { text: '取消', style: 'cancel' },
        {
          text: item.kind === 'editorial' ? '移出书架' : '删除文章',
          style: item.kind === 'editorial' ? 'default' : 'destructive',
          onPress: () => performManagementAction(item),
        },
      ],
    );
  };

  const retryCloud = () => {
    if (cloudError?.kind === 'more') void loadMore();
    else void refreshImported();
  };
  const waitingForFirstData = editorialLoading || initialCloudLoading;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <BrandHeader label="导入" onPress={() => router.push('/import')} />
      <FlatList
        testID="shelf-list"
        key={columns}
        numColumns={columns}
        columnWrapperStyle={{ gap: 20 }}
        data={visibleItems}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={(
          <View>
            <PageHeading title="书架" description="把喜欢的，慢慢读完。" />
            {recent ? <TouchCard accessibilityLabel="继续上次阅读" onPress={() => {
              if (recent.kind === 'editorial') router.push({ pathname: '/editorial/[id]/read', params: { id: recent.articleId } });
              else router.push({ pathname: '/article-read', params: { id: recent.articleId } });
            }} style={[styles.resume, { backgroundColor: theme.surfaceAlt }]}>
              <Text style={[styles.resumeLabel, { color: theme.textMuted }]}>上次读到这里</Text>
              <Text style={[styles.resumeTitle, { color: theme.text }]}>{recent.kind === 'editorial' ? getEditorialArticle(recent.articleId)?.titleEn ?? '继续阅读' : recent.title}</Text>
              <View style={[styles.resumeAction, { backgroundColor: theme.accent }]}><Text style={{ color: theme.accentText, fontSize: 13.5, fontWeight: weight('semibold') }}>继续阅读</Text><Ionicons name="arrow-forward" size={14} color={theme.accentText} /></View>
            </TouchCard> : null}
            <View style={styles.bookshelfHeading}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                我的书架
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={managing ? '完成管理' : '管理书架'}
                onPress={() => setManaging((current) => !current)}>
                <Text style={[styles.manageHeader, { color: theme.textSecondary }]}>
                  {managing ? '完成' : '管理'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.filters, { backgroundColor: theme.surfaceAlt }]}>
              {FILTERS.map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === key }}
                  onPress={() => setFilter(key)}
                  style={[
                    styles.filter,
                    filter === key ? [styles.filterOn, { backgroundColor: theme.surface }] : null,
                  ]}>
                  <Text style={{
                    color: filter === key ? theme.text : theme.textSecondary,
                    fontSize: 13,
                    fontWeight: weight(filter === key ? 'semibold' : 'regular'),
                  }}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {initialCloudLoading ? (
              <View style={styles.inlineStatus}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={{ color: theme.textMuted }}>正在加载我的导入</Text>
              </View>
            ) : null}
            {cloudError ? (
              <View style={styles.errorRow}>
                <Text style={[styles.errorText, { color: theme.danger }]}>
                  {cloudError.message}
                </Text>
                <TouchableOpacity accessibilityRole="button" onPress={retryCloud}>
                  <Text style={{ color: theme.accent }}>重试</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {actionError ? (
              <Text style={[styles.actionError, { color: theme.danger }]}>
                {actionError}
              </Text>
            ) : null}
          </View>
        )}
        ListEmptyComponent={waitingForFirstData ? (
          <View style={styles.emptySpinner}><BlackHoleLoader size={120} label="正在整理书架" /></View>
        ) : allItems.length === 0 ? (
          <View style={styles.empty}>
            <EnterOnce><AbsorbIllustration size={200} /></EnterOnce>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              书架还是空的
            </Text>
            <Text style={[styles.emptyHint, { color: theme.textSecondary }]}>在外刊里点收藏，文章就会被收进这里。</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/')}
              style={[styles.emptyAction, { backgroundColor: theme.accent }]}>
              <Text style={{ color: theme.accentText, fontSize: 14, fontWeight: weight('semibold') }}>去外刊看看</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.filteredEmpty, { color: theme.textMuted }]}>
            当前筛选暂无内容
          </Text>
        )}
        ListFooterComponent={<View style={{ marginTop: 30 }}>{loadingMore ? <ActivityIndicator color={theme.accent} style={styles.footerSpinner} /> : null}<ImportSourceGrid /></View>}
        renderItem={({ item }) => (
          <View style={{ width: `${100 / columns - 3}%` }}>
          <ShelfRow
            item={item}
            managing={managing}
            deleting={deletingIds.has(item.id)}
            onOpen={openItem}
            onManage={(selected) => {
              if (managing) performManagementAction(selected);
              else showItemMenu(selected);
            }}
          />
          </View>
        )}
        onEndReached={() => { void loadMore(); }}
        onEndReachedThreshold={0.35}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between',
    minHeight: 52, paddingBottom: 10, paddingHorizontal: 16,
  },
  headerSide: { width: 36 },
  headerTitle: { fontSize: 18, fontWeight: weight('semibold') },
  content: { paddingHorizontal: 20, paddingTop: 12, width: '100%', maxWidth: 1160, alignSelf: 'center' },
  resume: { borderRadius: radius.card, padding: 16, marginBottom: 8 },
  resumeLabel: { fontSize: 12.5 },
  resumeTitle: { fontFamily: fonts.readingMedium, fontSize: 21, lineHeight: 28, marginTop: 6, marginBottom: 12 },
  resumeAction: { flexDirection: 'row', gap: 4, alignItems: 'center', alignSelf: 'flex-start', minHeight: 34, paddingLeft: 14, paddingRight: 12, borderRadius: radius.pill },
  bookshelfHeading: {
    alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 24,
  },
  sectionTitle: { fontSize: 19, lineHeight: 26, fontWeight: weight('semibold') },
  manageHeader: { fontSize: 14, fontWeight: weight('medium') },
  filters: { borderRadius: radius.pill, padding: 3, flexDirection: 'row', marginVertical: 12 },
  filter: {
    alignItems: 'center', flex: 1, borderRadius: radius.pill,
    justifyContent: 'center', minHeight: 32,
  },
  filterOn: { shadowColor: '#22171A', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  inlineStatus: {
    alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 10,
  },
  errorRow: {
    alignItems: 'center', flexDirection: 'row', gap: 12,
    justifyContent: 'space-between', marginBottom: 10,
  },
  errorText: { flex: 1, fontSize: 12 },
  actionError: { fontSize: 12, marginBottom: 10 },
  separator: { height: 10 },
  emptySpinner: { marginTop: 36, alignItems: 'center' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 28 },
  emptyTitle: { fontSize: 17, fontWeight: weight('semibold'), marginTop: 4 },
  emptyHint: { fontSize: 13.5, lineHeight: 21, textAlign: 'center' },
  emptyAction: { minHeight: 38, paddingHorizontal: 18, borderRadius: radius.pill, justifyContent: 'center', marginTop: 10 },
  filteredEmpty: { paddingVertical: 48, textAlign: 'center' },
  footerSpinner: { marginVertical: 18 },
});
