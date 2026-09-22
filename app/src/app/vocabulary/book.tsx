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
import {
  createIdempotencyKey,
  InstallationCredentialUnavailableError,
} from '@/api/installation';
import {
  getVocabularyWordContexts,
  getVocabularyWords,
  markVocabularyWordMastered,
  restoreVocabularyWord,
} from '@/api/practices';
import { Card } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { VocabularyLoadingProgress } from '@/features/library/VocabularyLoadingProgress';
import {
  localReviewTime,
  mergeVocabularyWords,
  wordReviewLabel,
} from '@/features/practice/wordPresentation';

type BookFilter = Extract<VocabularyWordFilter, 'today' | 'learning' | 'unlearned' | 'mastered'>;
type PageSummary = VocabularyWordPage['summary'];

const FILTERS: {
  value: BookFilter;
  label: string;
  count: (summary: PageSummary) => number;
}[] = [
  { value: 'today', label: '今日新增', count: (summary) => summary.todayCount },
  { value: 'learning', label: '在学', count: (summary) => summary.learningCount },
  { value: 'unlearned', label: '未学', count: (summary) => summary.unlearnedCount },
  { value: 'mastered', label: '已掌握', count: (summary) => summary.masteredCount },
];
const DEFAULT_FILTER: BookFilter = 'learning';
const PAGE_SIZE = 30;
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

function masteryErrorMessage(error: unknown): string {
  if (error instanceof InstallationCredentialUnavailableError) {
    return '云端词库请在 iOS 或 Android 设备上操作';
  }
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试';
}

function emptyCopy(filter: BookFilter, summary: PageSummary | null): { title: string; body: string } {
  if (summary?.totalCount === 0) {
    return {
      title: '还没有云端生词',
      body: '在文章阅读、主题短文练习或手动录入中添加的单词会出现在这里。',
    };
  }
  switch (filter) {
    case 'today':
      return { title: '今天还没有新增单词', body: '今天通过文章阅读或手动录入添加的单词会出现在这里。' };
    case 'learning':
      return { title: '当前没有在学单词', body: '完成一次有效练习后，单词会从未学进入在学。' };
    case 'unlearned':
      return { title: '当前没有未学单词', body: '新保存的单词会出现在这里，等待第一次练习。' };
    case 'mastered':
      return { title: '还没有已掌握单词', body: '在其他分类中使用「标记已掌握」把已经会的单词归档。' };
  }
}

function WordCard({ item, onMasteryChanged }: { item: VocabularyWord; onMasteryChanged: () => void }) {
  const { theme } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const [contexts, setContexts] = useState<VocabularyWordContexts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masteryPending, setMasteryPending] = useState(false);
  const [masteryError, setMasteryError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const masteryInFlightRef = useRef(false);

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

  const mastered = item.masteredAt !== null;
  const toggleMastery = async () => {
    if (masteryInFlightRef.current) return;
    masteryInFlightRef.current = true;
    setMasteryPending(true);
    setMasteryError(null);
    try {
      // One key per tap; the button stays disabled until this attempt settles.
      const idempotencyKey = await createIdempotencyKey();
      if (mastered) await restoreVocabularyWord(item.wordId, idempotencyKey);
      else await markVocabularyWordMastered(item.wordId, idempotencyKey);
      onMasteryChanged();
    } catch (cause) {
      if (mountedRef.current) setMasteryError(masteryErrorMessage(cause));
    } finally {
      masteryInFlightRef.current = false;
      if (mountedRef.current) setMasteryPending(false);
    }
  };

  return (
    <Card theme={theme} style={styles.wordCard}>
      <View style={styles.wordHeading}>
        <Text style={[styles.word, { color: theme.text }]}>{item.term}</Text>
        {mastered ? (
          <View style={[styles.masteredBadge, { backgroundColor: theme.accentSoft }]}>
            <Text style={{ color: theme.accent, fontSize: 11, fontWeight: weight('medium') }}>已掌握</Text>
          </View>
        ) : null}
      </View>
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
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={mastered ? `恢复学习 ${item.term}` : `标记 ${item.term} 已掌握`}
          disabled={masteryPending}
          onPress={() => void toggleMastery()}
          style={[styles.masteryButton, { borderColor: theme.border, opacity: masteryPending ? 0.65 : 1 }]}>
          {masteryPending ? (
            <ActivityIndicator color={theme.accent} size="small" />
          ) : (
            <Text style={[styles.masteryButtonText, { color: mastered ? theme.blue : theme.textSecondary }]}>
              {mastered ? '恢复学习' : '标记已掌握'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
      {masteryError ? (
        <Text accessibilityLiveRegion="polite" style={[styles.masteryError, { color: theme.danger }]}>
          {masteryError}
        </Text>
      ) : null}
      {item.lastPracticedAt ? (
        <Text style={[styles.lastPracticed, { color: theme.textMuted }]}>
          最近练习 {localReviewTime(item.lastPracticedAt)}
        </Text>
      ) : null}
    </Card>
  );
}

export default function VocabularyBookScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<BookFilter>(DEFAULT_FILTER);
  const [items, setItems] = useState<VocabularyWord[]>([]);
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [timing, setTiming] = useState<RefreshTiming | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState(Date.now);
  const [listError, setListError] = useState<ListError | null>(null);
  const focusedRef = useRef(false);
  const requestVersionRef = useRef(0);
  const pendingMoreRef = useRef(false);

  const loadFirstPage = useCallback(async () => {
    const version = ++requestVersionRef.current;
    pendingMoreRef.current = false;
    setLoadingMore(false);
    setInitialLoading(true);
    setLoadingStartedAt(Date.now());
    setListError(null);
    setNextCursor(null);
    setTiming(null);
    const isCurrent = () => focusedRef.current && requestVersionRef.current === version;
    try {
      const page = await getVocabularyWords({
        filter, limit: PAGE_SIZE, timeZone: DEVICE_TIME_ZONE,
      });
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
    setLoadingStartedAt(Date.now());
    setListError(null);
    try {
      const page = await getVocabularyWords({
        filter, cursor: nextCursor, limit: PAGE_SIZE, timeZone: DEVICE_TIME_ZONE,
      });
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

  const selectFilter = (value: BookFilter) => {
    if (filter === value) return;
    ++requestVersionRef.current;
    setItems([]);
    setNextCursor(null);
    setListError(null);
    setInitialLoading(true);
    setFilter(value);
  };

  const retry = () => void (listError?.source === 'more' ? loadMore() : loadFirstPage());
  const isEmpty = !initialLoading && !listError && items.length === 0;
  const empty = isEmpty ? emptyCopy(filter, summary) : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity accessibilityLabel="返回" hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>生词本</Text>
        <TouchableOpacity
          accessibilityLabel="录入新单词"
          hitSlop={8}
          onPress={() => router.push('/practice/new')}
          style={[styles.headerButton, { borderColor: theme.border }]}>
          <Ionicons name="add" size={20} color={theme.text} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.filterRow}>
          {FILTERS.map((option) => {
            const selected = filter === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => selectFilter(option.value)}
                style={[styles.filterChip, {
                  backgroundColor: selected ? theme.accentSoft : theme.surface,
                  borderColor: selected ? theme.accent : theme.border,
                }]}>
                <Text style={{ color: selected ? theme.accent : theme.textSecondary, fontSize: 13, fontWeight: weight(selected ? 'semibold' : 'regular') }}>
                  {option.label}{summary ? ` ${option.count(summary)}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {initialLoading ? (
          <View style={items.length ? styles.inlineError : styles.stateArea}>
            <VocabularyLoadingProgress
              label={items.length ? '正在更新复习安排…' : '正在加载词库…'}
              startedAt={loadingStartedAt}
            />
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
        {empty ? (
          <Card theme={theme} style={styles.stateCard}>
            <Ionicons name="library-outline" size={30} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>{empty.title}</Text>
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>{empty.body}</Text>
            {filter !== DEFAULT_FILTER && summary?.totalCount !== 0 ? (
              <TouchableOpacity onPress={() => selectFilter(DEFAULT_FILTER)} style={styles.contextToggle}>
                <Text style={{ color: theme.blue }}>查看在学单词</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        ) : null}
        {items.map((item) => (
          <WordCard
            key={`${item.wordId}:${item.contextCount}:${item.masteredAt ?? ''}`}
            item={item}
            onMasteryChanged={() => void loadFirstPage()}
          />
        ))}
        {loadingMore ? (
          <View style={styles.inlineError}>
            <VocabularyLoadingProgress label="正在加载更多单词…" startedAt={loadingStartedAt} />
          </View>
        ) : null}
        {nextCursor && !loadingMore ? (
          <TouchableOpacity disabled={initialLoading} onPress={() => void loadMore()} style={[styles.loadMoreButton, { borderColor: theme.border }]}>
            <Text style={[styles.loadMoreText, { color: theme.text }]}>加载更多</Text>
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
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  headerButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  content: { paddingHorizontal: 16 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    marginTop: 4,
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
  wordHeading: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  masteredBadge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
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
  masteryButton: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    marginLeft: 12,
    minHeight: 34,
    minWidth: 86,
    paddingHorizontal: 12,
  },
  masteryButtonText: { fontSize: 12, fontWeight: weight('semibold') },
  masteryError: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  lastPracticed: { fontSize: 11, marginTop: 5 },
  inlineError: { alignItems: 'center', paddingVertical: 12 },
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
