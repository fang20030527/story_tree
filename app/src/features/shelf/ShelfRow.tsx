import { EditorialReadBadge } from '@/features/editorial/EditorialReadBadge';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
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
          <ImportedCover
            key={item.article.coverImageUrl ?? 'no-cover'}
            imageUrl={item.article.coverImageUrl}
          />
        )}
        <View style={styles.info}>
          {editorial ? <EditorialReadBadge articleId={item.id} /> : null}
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

function ImportedCover({ imageUrl }: { imageUrl?: string | null }) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) {
    return <Image
      accessibilityLabel="文章封面"
      cachePolicy="memory-disk"
      contentFit="cover"
      onError={() => setFailed(true)}
      source={{ uri: imageUrl }}
      style={styles.cover}
      testID="imported-cover-image"
    />;
  }
  return <View testID="imported-cover-placeholder" style={[styles.cover, styles.placeholder, {
    backgroundColor: theme.surfaceAlt,
  }]}>
    <Ionicons name="document-text-outline" size={24} color={theme.accent} />
  </View>;
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 0, flex: 1,
    gap: 8, paddingVertical: 12,
  },
  body: { flex: 1, gap: 11 },
  cover: { borderRadius: 1, aspectRatio: .78, width: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  source: { fontSize: 11 },
  title: { fontSize: 14, fontWeight: weight('semibold'), lineHeight: 19, marginTop: 3 },
  meta: { fontSize: 11, marginTop: 5 },
  manage: { alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: 6 },
  manageText: { fontSize: 12, fontWeight: weight('medium') },
});
