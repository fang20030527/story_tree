import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { getEditorialArticle } from '@/features/editorial/catalog';
import {
  refreshRemoteEditorialCatalog,
  useRemoteEditorialCatalogVersion,
} from '@/features/editorial/remoteCatalog';
import { formatEntryDate, sourceLabel } from '@/features/library/format';

import {
  clearRecentViews,
  loadRecentViews,
  removeRecentView,
  type RecentView,
} from './libraryStorage';

type Props = {
  load?: () => Promise<RecentView[]>;
  remove?: (key: string) => Promise<void>;
  clear?: () => Promise<void>;
};

const describeEntry = (entry: RecentView) => {
  if (entry.kind === 'imported') {
    return {
      title: entry.title,
      meta: `${sourceLabel(entry.sourceKind)} · ${entry.wordCount} 词 · ${formatEntryDate(entry.timestamp)}`,
      destination: {
        pathname: '/article-read' as const,
        params: { id: entry.articleId },
      },
    };
  }
  const article = getEditorialArticle(entry.articleId);
  if (!article) return null;
  return {
    title: article.titleZh,
    meta: `${article.source} · ${article.wordCount} 词 · ${formatEntryDate(entry.timestamp)}`,
    destination: {
      pathname: '/editorial/[id]/read' as const,
      params: { id: article.id },
    },
  };
};

const recentKey = (entry: RecentView) => `${entry.kind}:${entry.articleId}`;

export function RecentListScreen({
  load = loadRecentViews,
  remove = removeRecentView,
  clear = clearRecentViews,
}: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<RecentView[]>([]);
  useRemoteEditorialCatalogVersion();

  const reload = useCallback(async () => {
    try {
      setEntries(await load());
    } catch {
      setEntries([]);
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refreshRemoteEditorialCatalog().catch(() => undefined);
      void load()
        .then((items) => {
          if (active) setEntries(items);
        })
        .catch(() => {
          if (active) setEntries([]);
        });
      return () => {
        active = false;
      };
    }, [load]),
  );

  const confirmClear = () => {
    if (entries.length === 0) return;
    Alert.alert('清空最近观看', '确定要清空全部最近观看记录吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          void clear().then(reload).catch(() => undefined);
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>最近观看</Text>
        {entries.length > 0 ? (
          <TouchableOpacity
            onPress={confirmClear}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="清空最近观看">
            <Text style={[styles.clearText, { color: theme.textSecondary }]}>清空</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
      <FlatList
        data={entries}
        keyExtractor={recentKey}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={38} color={theme.textMuted} />
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>还没有阅读记录</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const description = describeEntry(item);
          if (!description) return null;
          return (
            <View
              style={[
                styles.row,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}>
              <TouchableOpacity
                style={styles.rowBody}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={description.title}
                onPress={() =>
                  router.push(
                    description.destination as Parameters<typeof router.push>[0],
                  )
                }>
                <Text
                  numberOfLines={2}
                  style={[styles.rowTitle, { color: theme.text }]}>
                  {description.title}
                </Text>
                <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                  {description.meta}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="删除这条记录"
                accessibilityHint={description.title}
                onPress={() => {
                  void remove(recentKey(item)).then(reload).catch(() => undefined);
                }}>
                <Ionicons name="trash-outline" size={18} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  headerSpacer: { width: 26 },
  clearText: { fontSize: 14 },
  list: { gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  row: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: weight('medium'), lineHeight: 21 },
  rowMeta: { fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', gap: 12, paddingTop: 120 },
  emptyText: { fontSize: 14 },
});
