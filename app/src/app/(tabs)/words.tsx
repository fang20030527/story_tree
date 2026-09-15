import { Ionicons } from '@expo/vector-icons';
import type {
  VocabularyWord,
  VocabularyWordContexts,
  VocabularyWordFilter,
  VocabularyWordPage,
} from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { InstallationCredentialUnavailableError } from '@/api/installation';
import { getVocabularyWordContexts, getVocabularyWords } from '@/api/practices';
import { Card } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  localReviewTime,
  mergeVocabularyWords,
  wordReviewLabel,
} from '@/features/practice/wordPresentation';

const FILTERS: { value: VocabularyWordFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'due', label: '待复习' },
  { value: 'scheduled', label: '未到时间' },
];
const PAGE_SIZE = 30;

type ListError = { message: string; source: 'first' | 'more' };
type RefreshTiming = Pick<VocabularyWordPage, 'evaluatedAt' | 'nextRefreshAt'> & {
  receivedAt: number;
};

function vocabularyErrorMessage(error: unknown): string {
  if (error instanceof InstallationCredentialUnavailableError) {
    return '云端词库请在 iOS 或 Android 设备上查看';
  }
  return error instanceof ApiError ? error.message : '暂时无法加载词库';
}

function WordCard({ item }: { item: VocabularyWord }) {
  const { theme } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const [contexts, setContexts] = useState<VocabularyWordContexts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadContexts = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await getVocabularyWordContexts(item.wordId);
      if (mountedRef.current) setContexts(result);
    } catch (cause) {
      if (mountedRef.current) setError(vocabularyErrorMessage(cause));
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <Card theme={theme} style={styles.wordCard}>
      <Text style={[styles.word, { color: theme.text }]}>{item.term}</Text>
      <Text style={[styles.meaning, { color: theme.accent }]}>{item.meaningZh}</Text>
      <Text style={[styles.reviewReason, {
        color: item.reviewReason === 'scheduled' ? theme.textSecondary : theme.blue,
      }]}>
        {wordReviewLabel(item)}
      </Text>
      {item.sourceSentence ? (
        <Text numberOfLines={3} style={[styles.context, { color: theme.textSecondary }]}>
          {item.sourceSentence}
        </Text>
      ) : null}
      {item.contextCount > 1 ? (
        <>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? '收起' : '展开'} ${item.term} 的已保存语境`}
            accessibilityState={{ expanded }}
            onPress={() => {
              setExpanded(!expanded);
              if (!expanded && !contexts) void loadContexts();
            }}
            style={styles.contextToggle}>
            <Text style={{ color: theme.blue, fontSize: 12 }}>
              {expanded ? '收起语境' : `查看 ${item.contextCount} 个已保存语境`}
            </Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={theme.blue} />
          </TouchableOpacity>
          {expanded ? (
            <View style={[styles.contextPanel, { borderColor: theme.border }]}>
              <Text style={[styles.metrics, { color: theme.textMuted }]}>
                不同含义共享一个复习计划，每次练习其中一个语境。
              </Text>
              {loading ? <ActivityIndicator color={theme.accent} size="small" /> : null}
              {error ? (
                <View>
                  <Text style={[styles.stateText, { color: theme.danger }]}>{error}</Text>
                  <TouchableOpacity onPress={() => void loadContexts()} accessibilityLabel={`重试加载 ${item.term} 的语境`}>
                    <Text style={[styles.inlineRetry, { color: theme.blue }]}>重试加载语境</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {contexts?.contexts.map((context) => (
                <View key={context.id} style={styles.savedContext}>
                  <Text style={[styles.meaning, { color: theme.text }]}>{context.meaningZh}</Text>
                  {context.sourceSentence ? (
                    <Text style={[styles.context, { color: theme.textSecondary }]}>{context.sourceSentence}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      <View style={styles.wordFooter}>
        <Text style={[styles.metrics, { color: theme.textMuted }]}>
          练习 {item.practiceCount} 次 · 独立答对 {item.independentCorrectCount} 次
          {'\n'}使用帮助 {item.assistedCount} 次
        </Text>
      </View>
      {item.lastPracticedAt ? (
        <Text style={[styles.lastPracticed, { color: theme.textMuted }]}>
          最近练习 {localReviewTime(item.lastPracticedAt)}
        </Text>
      ) : null}
    </Card>
  );
}

export default function WordsScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<VocabularyWordFilter>('all');
  const [items, setItems] = useState<VocabularyWord[]>([]);
  const [summary, setSummary] = useState<VocabularyWordPage['summary'] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [timing, setTiming] = useState<RefreshTiming | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<ListError | null>(null);
  const focusedRef = useRef(false);
  const requestVersionRef = useRef(0);
  const pendingMoreRef = useRef(false);

  const loadFirstPage = useCallback(async () => {
    const version = ++requestVersionRef.current;
    pendingMoreRef.current = false;
    setLoadingMore(false);
    setInitialLoading(true);
    setListError(null);
    setNextCursor(null);
    setTiming(null);
    const isCurrent = () => focusedRef.current && requestVersionRef.current === version;
    try {
      const page = await getVocabularyWords({ filter, limit: PAGE_SIZE });
      if (!isCurrent()) return;
      setItems(page.items);
      setSummary(page.summary);
      setNextCursor(page.nextCursor);
      setTiming({ evaluatedAt: page.evaluatedAt, nextRefreshAt: page.nextRefreshAt, receivedAt: Date.now() });
    } catch (error) {
      if (isCurrent()) setListError({ message: vocabularyErrorMessage(error), source: 'first' });
    } finally {
      if (isCurrent()) setInitialLoading(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    void loadFirstPage();
    return () => {
      focusedRef.current = false;
      ++requestVersionRef.current;
    };
  }, [loadFirstPage]));

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && previousState !== 'active' && focusedRef.current) {
        void loadFirstPage();
      }
      previousState = state;
    });
    return () => subscription.remove();
  }, [loadFirstPage]);

  useEffect(() => {
    if (!timing?.nextRefreshAt) return;
    // Anchor to server evaluation time so device clock skew does not delay due words.
    const dueIn = Date.parse(timing.nextRefreshAt) - Date.parse(timing.evaluatedAt);
    const delay = Math.min(2_147_483_647, Math.max(100, dueIn - (Date.now() - timing.receivedAt) + 100));
    const timeout = setTimeout(() => {
      if (focusedRef.current) void loadFirstPage();
    }, delay);
    return () => clearTimeout(timeout);
  }, [loadFirstPage, timing]);

  const loadMore = async () => {
    if (!nextCursor || initialLoading || pendingMoreRef.current) return;
    const version = requestVersionRef.current;
    const isCurrent = () => focusedRef.current && requestVersionRef.current === version;
    pendingMoreRef.current = true;
    setLoadingMore(true);
    setListError(null);
    try {
      const page = await getVocabularyWords({ filter, cursor: nextCursor, limit: PAGE_SIZE });
      if (!isCurrent()) return;
      setItems((current) => mergeVocabularyWords(current, page.items));
      setSummary(page.summary);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiError && error.code === 'VOCABULARY_CHANGED') {
        setItems([]);
        await loadFirstPage();
      } else {
        setListError({ message: vocabularyErrorMessage(error), source: 'more' });
      }
    } finally {
      if (isCurrent()) {
        pendingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  };

  const retry = () => void (listError?.source === 'more' ? loadMore() : loadFirstPage());
  const isEmpty = !initialLoading && !listError && items.length === 0;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>词库</Text>
        <TouchableOpacity
          accessibilityLabel="录入新单词"
          hitSlop={8}
          onPress={() => router.push('/practice/new')}
          style={[styles.headerButton, { borderColor: theme.border }]}>
          <Ionicons name="add" size={20} color={theme.text} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <Card theme={theme} style={styles.summary}>
          <View>
            <Text testID="due-word-count" style={[styles.summaryNum, { color: theme.text }]}>{summary?.dueCount ?? '—'}</Text>
            <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>个单词待复习</Text>
          </View>
          <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/practice/from-vocabulary')} style={[styles.reviewButton, { backgroundColor: theme.accent }]}>
            <Ionicons name="sparkles" size={14} color={theme.accentText} />
            <Text style={[styles.reviewButtonText, { color: theme.accentText }]}>创建主题短文</Text>
          </TouchableOpacity>
        </Card>
        <Text style={[styles.summaryHint, { color: theme.textMuted }]}>
          根据练习表现和间隔时间安排复习，优先巩固容易忘的单词。
        </Text>
        <View style={styles.filterRow}>
          {FILTERS.map((option) => (
            <TouchableOpacity
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === option.value }}
              onPress={() => {
                if (filter === option.value) return;
                ++requestVersionRef.current;
                setItems([]);
                setNextCursor(null);
                setListError(null);
                setInitialLoading(true);
                setFilter(option.value);
              }}
              style={[styles.filterChip, {
                backgroundColor: filter === option.value ? theme.accentSoft : theme.surface,
                borderColor: filter === option.value ? theme.accent : theme.border,
              }]}>
              <Text style={{ color: filter === option.value ? theme.accent : theme.textSecondary, fontSize: 13, fontWeight: weight(filter === option.value ? 'semibold' : 'regular') }}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {initialLoading ? (
          <View style={items.length ? styles.inlineError : styles.stateArea}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[styles.stateText, { color: theme.textMuted }]}>{items.length ? '正在更新复习安排…' : '正在加载词库…'}</Text>
          </View>
        ) : null}
        {listError ? (
          <Card theme={theme} style={styles.stateCard}>
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>{listError.message}</Text>
            <TouchableOpacity onPress={retry} style={[styles.retryButton, { borderColor: theme.border }]}>
              <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
            </TouchableOpacity>
          </Card>
        ) : null}
        {isEmpty ? (
          <Card theme={theme} style={styles.stateCard}>
            <Ionicons name="library-outline" size={30} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {summary?.totalCount === 0 ? '还没有云端生词' : filter === 'due' ? '当前没有待复习单词' : '当前没有未到时间的单词'}
            </Text>
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>
              {summary?.totalCount === 0 ? '在文章阅读或主题短文中保存的单词会出现在这里。' : '复习安排会随时间和练习表现更新。'}
            </Text>
            {filter !== 'all' && summary?.totalCount !== 0 ? (
              <TouchableOpacity onPress={() => setFilter('all')} style={styles.contextToggle}>
                <Text style={{ color: theme.blue }}>查看全部词库</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        ) : null}
        {items.map((item) => <WordCard key={`${item.wordId}:${item.contextCount}`} item={item} />)}
        {nextCursor ? (
          <TouchableOpacity disabled={loadingMore || initialLoading} onPress={() => void loadMore()} style={[styles.loadMoreButton, { borderColor: theme.border, opacity: loadingMore ? 0.65 : 1 }]}>
            {loadingMore ? <ActivityIndicator color={theme.accent} size="small" /> : <Text style={[styles.loadMoreText, { color: theme.text }]}>加载更多</Text>}
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
  wordCard: { marginBottom: 10, padding: 14 },
  reviewReason: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  contextToggle: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 36, marginTop: 5 },
  contextPanel: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  savedContext: { marginTop: 12 },
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
  lastPracticed: { fontSize: 11, marginTop: 5 },
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
