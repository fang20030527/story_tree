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
import { formatEntryDate, sourceLabel } from '@/features/library/format';
import type { LibraryEntry } from '@/features/library/libraryStorage';

type Props = {
  title: string;
  load: () => Promise<LibraryEntry[]>;
  emptyIcon: keyof typeof Ionicons.glyphMap;
  emptyText: string;
  onRemove?: (articleId: string) => Promise<void>;
  removeLabel?: string;
  onClearAll?: () => Promise<void>;
  clearLabel?: string;
  clearConfirmTitle?: string;
  clearConfirmMessage?: string;
};

export function LibraryListScreen({
  title,
  load,
  emptyIcon,
  emptyText,
  onRemove,
  removeLabel,
  onClearAll,
  clearLabel,
  clearConfirmTitle,
  clearConfirmMessage,
}: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      load()
        .then((items) => {
          if (mounted) setEntries(items);
        })
        .catch(() => {
          if (mounted) setEntries([]);
        });
      return () => {
        mounted = false;
      };
    }, [load]),
  );

  const confirmClearAll = () => {
    if (!onClearAll || entries.length === 0) return;
    Alert.alert(
      clearConfirmTitle ?? '清空全部',
      clearConfirmMessage ?? '确定要清空全部记录吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: () => {
            void onClearAll()
              .then(load)
              .then(setEntries)
              .catch(() => undefined);
          },
        },
      ],
    );
  };

  const removeEntry = (articleId: string) => {
    if (!onRemove) return;
    void onRemove(articleId)
      .then(load)
      .then(setEntries)
      .catch(() => undefined);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{title}</Text>
        {onClearAll && entries.length > 0 ? (
          <TouchableOpacity onPress={confirmClearAll} hitSlop={8}>
            <Text style={[styles.clearText, { color: theme.textSecondary }]}>
              {clearLabel ?? '清空'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.articleId}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name={emptyIcon} size={38} color={theme.textMuted} />
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              {emptyText}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() =>
              router.push({
                pathname: '/article-read',
                params: { id: item.articleId },
              })
            }
            style={[
              styles.row,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <View style={styles.rowBody}>
              <Text
                numberOfLines={2}
                style={[styles.rowTitle, { color: theme.text }]}>
                {item.title}
              </Text>
              <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                {sourceLabel(item.sourceKind)} · {item.wordCount} 词 ·{' '}
                {formatEntryDate(item.timestamp)}
              </Text>
            </View>
            {onRemove ? (
              <TouchableOpacity
                onPress={() => removeEntry(item.articleId)}
                hitSlop={8}
                accessibilityLabel={removeLabel ?? '移除'}>
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={theme.textMuted}
                />
              </TouchableOpacity>
            ) : (
              <Ionicons
                name="chevron-forward"
                size={16}
                color={theme.textMuted}
              />
            )}
          </TouchableOpacity>
        )}
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
  empty: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 120,
  },
  emptyText: { fontSize: 14 },
});
