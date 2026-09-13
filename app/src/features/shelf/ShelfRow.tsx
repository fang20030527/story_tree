import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { EditorialImage } from '@/features/editorial/EditorialImage';
import { formatEntryDate, sourceLabel } from '@/features/library/format';

import type { ShelfItem } from './shelfModel';

type Props = {
  item: ShelfItem;
  managing: boolean;
  deleting: boolean;
  onOpen: (item: ShelfItem) => void;
  onManage: (item: ShelfItem) => void;
};

export function ShelfRow({ item, managing, deleting, onOpen, onManage }: Props) {
  const { theme } = useAppTheme();
  const editorial = item.kind === 'editorial';
  const title = item.kind === 'editorial'
    ? item.article.titleZh
    : item.article.title;

  return (
    <View style={[
      styles.row,
      { backgroundColor: theme.surface, borderColor: theme.border },
    ]}>
      <TouchableOpacity
        style={styles.body}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${title}，打开文章`}
        onPress={() => onOpen(item)}>
        {item.kind === 'editorial' ? (
          <EditorialImage uri={item.article.image} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.placeholder, {
            backgroundColor: theme.surfaceAlt,
          }]}>
            <Ionicons name="document-text-outline" size={24} color={theme.accent} />
          </View>
        )}
        <View style={styles.info}>
          <Text style={[styles.source, { color: theme.textMuted }]}>
            {item.kind === 'editorial'
              ? item.article.source
              : sourceLabel(item.article.sourceKind)}
          </Text>
          <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>
            {title}
          </Text>
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            {item.article.wordCount} 词
            {item.kind === 'editorial' ? ` · ${item.article.minutes} 分钟` : ''}
            {' · '}{formatEntryDate(item.timestamp)}
          </Text>
        </View>
      </TouchableOpacity>
      {managing ? (
        <TouchableOpacity
          style={styles.manage}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel={editorial ? '移出书架' : '删除文章'}
          accessibilityState={{ disabled: deleting, busy: deleting }}
          onPress={() => onManage(item)}>
          {deleting ? (
            <ActivityIndicator size="small" color={theme.danger} />
          ) : (
            <Text style={[
              styles.manageText,
              { color: editorial ? theme.textSecondary : theme.danger },
            ]}>
              {editorial ? '移出书架' : '删除文章'}
            </Text>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.manage}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel={`${title}，更多操作`}
          accessibilityState={{ disabled: deleting, busy: deleting }}
          onPress={() => onManage(item)}>
          {deleting ? (
            <ActivityIndicator size="small" color={theme.danger} />
          ) : (
            <Ionicons
              name="ellipsis-horizontal"
              size={18}
              color={theme.textMuted}
            />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center', borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row',
    gap: 8, padding: 10,
  },
  body: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 11 },
  cover: { borderRadius: 8, height: 68, width: 68 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  source: { fontSize: 11 },
  title: { fontSize: 14, fontWeight: weight('semibold'), lineHeight: 19, marginTop: 3 },
  meta: { fontSize: 11, marginTop: 5 },
  manage: { alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: 6 },
  manageText: { fontSize: 12, fontWeight: weight('medium') },
});
