import { Ionicons } from '@expo/vector-icons';
import type { VocabularyItemDto } from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { InstallationCredentialUnavailableError } from '@/api/installation';
import { getVocabulary } from '@/api/practices';
import { Card, Chip } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  mergeVocabularyItems,
  vocabularyStatusLabel,
} from '@/features/practice/vocabularyPresentation';

const FILTERS = [
  '全部',
  '待复习',
  '复习中',
  '已掌握',
  '用户自报已会',
] as const;
const PAGE_SIZE = 30;

type VocabularyFilter = (typeof FILTERS)[number];

function vocabularyErrorMessage(error: unknown): string {
  if (error instanceof InstallationCredentialUnavailableError) {
    return '云端词库请在 iOS 或 Android 设备上查看';
  }
  return error instanceof ApiError
    ? error.message
    : '暂时无法加载词库';
}

function lastPracticedLabel(lastPracticedAt: string | null): string {
  return lastPracticedAt
    ? `最近练习 ${lastPracticedAt.slice(0, 10)}`
    : '尚未练习';
}

export default function WordsScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<VocabularyFilter>('全部');
  const [items, setItems] = useState<VocabularyItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const focusedRef = useRef(false);
  const firstPageRequestRef = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const requestId = firstPageRequestRef.current + 1;
    firstPageRequestRef.current = requestId;
    setInitialLoading(true);
    setListError(null);
    setNextCursor(null);

    try {
      const page = await getVocabulary({ limit: PAGE_SIZE });
      if (!focusedRef.current || firstPageRequestRef.current !== requestId) {
        return;
      }
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (focusedRef.current && firstPageRequestRef.current === requestId) {
        setListError(vocabularyErrorMessage(error));
      }
    } finally {
      if (focusedRef.current && firstPageRequestRef.current === requestId) {
        setInitialLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void loadFirstPage();

      return () => {
        focusedRef.current = false;
      };
    }, [loadFirstPage]),
  );

  const visibleItems = useMemo(
    () => filter === '全部'
      ? items
      : items.filter((item) => vocabularyStatusLabel(item.status) === filter),
    [filter, items],
  );
  const reviewCount = items.filter(
    (item) => item.status === 'pending' || item.status === 'reviewing',
  ).length;

  const statusColor = (status: VocabularyItemDto['status']) => {
    if (status === 'mastered') return theme.green;
    if (status === 'reviewing') return theme.accent;
    if (status === 'self_reported') return theme.textSecondary;
    return theme.blue;
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setListError(null);
    try {
      const page = await getVocabulary({
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setItems((current) => mergeVocabularyItems(current, page.items));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setListError(vocabularyErrorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const retry = () => void loadFirstPage();

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>词库</Text>
        <TouchableOpacity
          accessibilityLabel="录入新词义"
          hitSlop={8}
          onPress={() => router.push('/practice/new')}
          style={[styles.headerButton, { borderColor: theme.border }]}>
          <Ionicons name="add" size={20} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}>
        <Card theme={theme} style={styles.summary}>
          <View>
            <Text style={[styles.summaryNum, { color: theme.text }]}>
              {reviewCount}
            </Text>
            <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
              个义项待复习
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push('/practice/new')}
            style={[styles.reviewButton, { backgroundColor: theme.accent }]}>
            <Ionicons name="sparkles" size={14} color={theme.accentText} />
            <Text style={[styles.reviewButtonText, { color: theme.accentText }]}>
              创建长文练习
            </Text>
          </TouchableOpacity>
        </Card>
        <Text style={[styles.summaryHint, { color: theme.textMuted }]}>
          词库状态会根据首次作答和阅读辅助自动更新
        </Text>

        <View style={styles.filterRow}>
          {FILTERS.map((nextFilter) => (
            <TouchableOpacity
              key={nextFilter}
              onPress={() => setFilter(nextFilter)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === nextFilter
                    ? theme.accentSoft
                    : theme.surface,
                  borderColor: filter === nextFilter
                    ? theme.accent
                    : theme.border,
                },
              ]}>
              <Text
                style={{
                  color: filter === nextFilter
                    ? theme.accent
                    : theme.textSecondary,
                  fontSize: 13,
                  fontWeight: weight(
                    filter === nextFilter ? 'semibold' : 'regular',
                  ),
                }}>
                {nextFilter}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {initialLoading && items.length === 0 ? (
          <View style={styles.stateArea}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[styles.stateText, { color: theme.textMuted }]}>
              正在加载词库…
            </Text>
          </View>
        ) : null}

        {!initialLoading && listError && items.length === 0 ? (
          <Card theme={theme} style={styles.stateCard}>
            <Ionicons name="cloud-offline-outline" size={28} color={theme.textMuted} />
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>
              {listError}
            </Text>
            <TouchableOpacity
              onPress={retry}
              style={[styles.retryButton, { borderColor: theme.border }]}>
              <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {!initialLoading && !listError && items.length === 0 ? (
          <Card theme={theme} style={styles.stateCard}>
            <Ionicons name="library-outline" size={30} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              还没有云端生词
            </Text>
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>
              在文章阅读或长文练习中保存的义项会出现在这里。
            </Text>
          </Card>
        ) : null}

        {items.length > 0 && visibleItems.length === 0 ? (
          <Text style={[styles.filteredEmpty, { color: theme.textMuted }]}>
            这个分类暂无义项
          </Text>
        ) : null}

        {visibleItems.map((item) => (
          <Card key={item.id} theme={theme} style={styles.wordCard}>
            <View style={styles.wordHeader}>
              <View style={styles.wordMain}>
                <Text style={[styles.word, { color: theme.text }]}>
                  {item.term}
                </Text>
                <Text style={[styles.meaning, { color: theme.accent }]}>
                  {item.meaningZh}
                </Text>
              </View>
              <Chip
                bg={theme.accentSoft}
                color={statusColor(item.status)}
                label={vocabularyStatusLabel(item.status)}
              />
            </View>

            {item.sourceSentence ? (
              <Text
                numberOfLines={3}
                style={[styles.context, { color: theme.textSecondary }]}>
                {item.sourceSentence}
              </Text>
            ) : null}

            <View style={styles.wordFooter}>
              <Text style={[styles.metrics, { color: theme.textMuted }]}>
                练习 {item.practiceCount} 次 · 首次答对 {item.firstTryCorrectCount} 次
                {'\n'}使用帮助 {item.assistedCount} 次
              </Text>
              <Text style={[styles.lastPracticed, { color: theme.textMuted }]}>
                {lastPracticedLabel(item.lastPracticedAt)}
              </Text>
            </View>
          </Card>
        ))}

        {listError && items.length > 0 ? (
          <View style={styles.inlineError}>
            <Text style={[styles.inlineErrorText, { color: theme.danger }]}>
              {listError}
            </Text>
            <TouchableOpacity onPress={nextCursor ? () => void loadMore() : retry}>
              <Text style={[styles.inlineRetry, { color: theme.blue }]}>
                重试
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {nextCursor ? (
          <TouchableOpacity
            disabled={loadingMore}
            onPress={() => void loadMore()}
            style={[
              styles.loadMoreButton,
              { borderColor: theme.border, opacity: loadingMore ? 0.65 : 1 },
            ]}>
            {loadingMore ? (
              <ActivityIndicator color={theme.accent} size="small" />
            ) : (
              <Text style={[styles.loadMoreText, { color: theme.text }]}>
                加载更多
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: weight('bold') },
  headerButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  content: { paddingHorizontal: 16 },
  summary: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 18,
  },
  summaryNum: { fontSize: 32, fontWeight: weight('bold') },
  summaryLabel: { fontSize: 13, marginTop: 2 },
  reviewButton: {
    alignItems: 'center',
    borderRadius: 20,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  reviewButtonText: { fontSize: 13, fontWeight: weight('bold') },
  summaryHint: { fontSize: 12, lineHeight: 17, marginBottom: 4, marginTop: 10 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    marginTop: 16,
  },
  filterChip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  stateArea: { alignItems: 'center', paddingVertical: 52 },
  stateCard: { alignItems: 'center', padding: 28 },
  stateText: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: weight('semibold'), marginTop: 12 },
  retryButton: {
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 40,
    paddingHorizontal: 22,
  },
  retryText: { fontSize: 14, fontWeight: weight('semibold') },
  filteredEmpty: { fontSize: 14, paddingVertical: 38, textAlign: 'center' },
  wordCard: { marginBottom: 10, padding: 14 },
  wordHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  wordMain: { flex: 1 },
  word: { fontSize: 17, fontWeight: weight('bold') },
  meaning: { fontSize: 13, fontWeight: weight('medium'), marginTop: 3 },
  context: { fontSize: 13, fontStyle: 'italic', lineHeight: 19, marginTop: 9 },
  wordFooter: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 11,
  },
  metrics: { flex: 1, fontSize: 11, lineHeight: 17 },
  lastPracticed: { fontSize: 11, marginLeft: 12, textAlign: 'right' },
  inlineError: { alignItems: 'center', paddingVertical: 12 },
  inlineErrorText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  inlineRetry: { fontSize: 13, fontWeight: weight('semibold'), marginTop: 6 },
  loadMoreButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 44,
  },
  loadMoreText: { fontSize: 14, fontWeight: weight('semibold') },
});
