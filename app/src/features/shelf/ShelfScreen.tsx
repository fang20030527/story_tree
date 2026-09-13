import type { ImportedArticleSummaryDto } from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  deleteImportedArticle,
  listImportedArticles,
} from '@/api/articles';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

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
  const [editorialEntries, setEditorialEntries] = useState<EditorialShelfEntry[]>([]);
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
      setEditorialLoading(true);
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
    [editorialEntries, importedArticles],
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
    Alert.alert(
      '永久删除文章？',
      '正文和翻译将永久删除，无法恢复；已加入词库的词义和学习进度会保留。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除文章',
          style: 'destructive',
          onPress: () => { void permanentlyDelete(item.id); },
        },
      ],
    );
  };

  const showItemMenu = (item: ShelfItem) => {
    const title = item.kind === 'editorial'
      ? item.article.titleZh
      : item.article.title;
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
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerSide} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>书架</Text>
        <View style={styles.headerSide} />
      </View>
      <FlatList
        testID="shelf-list"
        data={visibleItems}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={(
          <View>
            <ImportSourceGrid />
            <View style={styles.bookshelfHeading}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                我的书架
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={managing ? '完成管理' : '管理书架'}
                onPress={() => setManaging((current) => !current)}>
                <Text style={[styles.manageHeader, { color: theme.blue }]}>
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
                    filter === key && { backgroundColor: theme.surface },
                  ]}>
                  <Text style={{
                    color: filter === key ? theme.text : theme.textMuted,
                    fontSize: 12,
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
                  <Text style={{ color: theme.blue }}>重试</Text>
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
          <ActivityIndicator color={theme.accent} style={styles.emptySpinner} />
        ) : allItems.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              书架还是空的
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/')}>
              <Text style={{ color: theme.blue }}>去外刊看看</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.filteredEmpty, { color: theme.textMuted }]}>
            当前筛选暂无内容
          </Text>
        )}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator color={theme.accent} style={styles.footerSpinner} />
        ) : null}
        renderItem={({ item }) => (
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
  content: { paddingHorizontal: 16 },
  bookshelfHeading: {
    alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 24,
  },
  sectionTitle: { fontSize: 19, fontWeight: weight('bold') },
  manageHeader: { fontSize: 14, fontWeight: weight('medium') },
  filters: { borderRadius: 10, flexDirection: 'row', marginVertical: 12, padding: 4 },
  filter: {
    alignItems: 'center', borderRadius: 8, flex: 1,
    justifyContent: 'center', paddingVertical: 8,
  },
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
  emptySpinner: { marginTop: 48 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  emptyTitle: { fontSize: 16, fontWeight: weight('semibold') },
  filteredEmpty: { paddingVertical: 48, textAlign: 'center' },
  footerSpinner: { marginVertical: 18 },
});
