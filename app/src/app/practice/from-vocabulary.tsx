import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { createPractice, getDashboard, registerAnonymous } from '@/api/practices';
import { Card } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { ContinuePracticeCard } from '@/features/practice/ContinuePracticeCard';
import { PracticePreferencesCard } from '@/features/practice/PracticePreferencesCard';
import { loadPracticeTargetCount } from '@/features/practice/practicePreferences';
import {
  clearCreatePracticeOperation, hasConfirmedAge, loadCreatePracticeOperation,
  prepareCreatePracticeOperation, saveActivePracticeId, saveAgeConfirmation,
} from '@/features/practice/practiceStorage';

type CandidateStats = { dueLearningCount: number; unlearnedCount: number };

function statsErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '暂时无法加载可练习单词数量';
}

export default function VocabularyPracticeSetupScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [needsAge, setNeedsAge] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<CandidateStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const statsVersion = useRef(0);

  const loadStats = useCallback(async () => {
    const version = ++statsVersion.current;
    setStatsLoading(true);
    setStatsError(null);
    try {
      const dashboard = await getDashboard();
      if (!mounted.current || statsVersion.current !== version) return;
      setStats({
        dueLearningCount: dashboard.dueLearningCount,
        unlearnedCount: dashboard.unlearnedCount,
      });
    } catch (error) {
      if (mounted.current && statsVersion.current === version) {
        setStatsError(statsErrorMessage(error));
      }
    } finally {
      if (mounted.current && statsVersion.current === version) setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useFocusEffect(useCallback(() => {
    void loadStats();
  }, [loadStats]));

  // Only called from the start button / age confirmation, never on mount:
  // entering this page must not create a practice or spend quota.
  const start = useCallback(async (confirmAge = false) => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      if (confirmAge) await saveAgeConfirmation();
      const confirmed = confirmAge || await hasConfirmedAge();
      if (!mounted.current) return;
      if (!confirmed) { setNeedsAge(true); return; }
      setNeedsAge(false);
      const pending = await loadCreatePracticeOperation();
      if (pending && !('source' in pending.request)) {
        throw new Error('已有一次手动录入的创建请求待确认，请先继续上次操作');
      }
      // A retry must retain its original payload and key, even after settings change.
      const count = pending && 'source' in pending.request
        ? pending.request.targetCount : await loadPracticeTargetCount();
      const operation = pending ?? await prepareCreatePracticeOperation({
        source: 'vocabulary', format: 'topic_set', targetCount: count,
      });
      await registerAnonymous(true);
      const accepted = await createPractice(operation.request, operation.idempotencyKey);
      await saveActivePracticeId(accepted.practiceId);
      if (mounted.current) router.replace({
        pathname: '/practice/[id]/generating',
        params: { id: accepted.practiceId, origin: 'vocabulary' },
      });
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        await clearCreatePracticeOperation().catch(() => undefined);
      }
      if (mounted.current) setMessage(error instanceof Error ? error.message : '暂时无法创建练习，请稍后重试');
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }, []);

  const candidates = stats ? stats.dueLearningCount + stats.unlearnedCount : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="返回" hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>AI 阅读练习</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ContinuePracticeCard />
        <PracticePreferencesCard />
        <Card theme={theme} style={styles.statsCard}>
          <Text style={[styles.statsTitle, { color: theme.text }]}>本次自动选词</Text>
          {statsLoading && !stats ? (
            <View style={styles.statsLoading}>
              <ActivityIndicator color={theme.accent} size="small" />
              <Text style={[styles.statsHint, { color: theme.textMuted }]}>正在统计可练习单词…</Text>
            </View>
          ) : null}
          {stats ? (
            <Text style={[styles.statsLine, { color: theme.textSecondary }]}>
              到期在学 <Text testID="due-learning-count" style={{ color: theme.text, fontWeight: weight('bold') }}>{stats.dueLearningCount}</Text> 词
              · 未学 <Text testID="unlearned-count" style={{ color: theme.text, fontWeight: weight('bold') }}>{stats.unlearnedCount}</Text> 词
            </Text>
          ) : null}
          <Text style={[styles.statsHint, { color: theme.textMuted }]}>
            优先选择到期的在学词，再用未学词补足目标数量；未到期和已掌握的单词不会进入练习。
          </Text>
          {statsError ? (
            <View style={styles.statsError}>
              <Text style={[styles.statsHint, { color: theme.danger }]}>{statsError}</Text>
              <TouchableOpacity onPress={() => void loadStats()} style={[styles.retryButton, { borderColor: theme.border }]}>
                <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>
        {candidates === 0 ? (
          <Card theme={theme} style={styles.emptyCard}>
            <Ionicons name="library-outline" size={30} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>暂无可练习的单词</Text>
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
              生词本里还没有到期或未学的单词。可以先录入新单词，或等复习时间到达后再来。
            </Text>
            <TouchableOpacity onPress={() => router.push('/practice/new')} style={[styles.retryButton, { borderColor: theme.border }]}>
              <Text style={[styles.retryText, { color: theme.text }]}>录入新单词</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/vocabulary/book')} style={styles.link}>
              <Text style={{ color: theme.blue }}>查看生词本</Text>
            </TouchableOpacity>
          </Card>
        ) : null}
        {needsAge ? (
          <Card theme={theme} style={styles.emptyCard}>
            <Ionicons name="shield-checkmark" size={30} color={theme.accent} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>使用前请确认年龄</Text>
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
              AI 主题短文练习仅面向年满 14 周岁的用户，内容会经过安全检查。
            </Text>
            <TouchableOpacity
              disabled={submitting}
              onPress={() => void start(true)}
              style={[styles.primaryButton, { backgroundColor: theme.accent }]}>
              <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>我已年满 14 周岁</Text>
            </TouchableOpacity>
          </Card>
        ) : null}
        {message ? (
          <View style={styles.messageArea}>
            <Text style={[styles.emptyBody, { color: theme.danger }]}>{message}</Text>
            {!submitting ? (
              <TouchableOpacity onPress={() => void start(needsAge)} style={[styles.retryButton, { borderColor: theme.border }]}>
                <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {candidates !== null && candidates > 0 && !needsAge ? (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void start()}
            style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: submitting ? 0.65 : 1 }]}>
            {submitting ? (
              <ActivityIndicator accessibilityLabel="正在创建练习" color={theme.accentText} />
            ) : (
              <>
                <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>开始多情景阅读练习</Text>
                <Ionicons name="sparkles" size={18} color={theme.accentText} />
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  content: { padding: 16, paddingBottom: 28, gap: 14 },
  statsCard: { padding: 16 },
  statsTitle: { fontSize: 15, fontWeight: weight('bold') },
  statsLine: { fontSize: 14, marginTop: 10 },
  statsHint: { fontSize: 12, lineHeight: 19, marginTop: 8 },
  statsLoading: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  statsError: { alignItems: 'flex-start', marginTop: 4 },
  emptyCard: { alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: weight('semibold'), marginTop: 12 },
  emptyBody: { fontSize: 13, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  messageArea: { alignItems: 'center', gap: 4 },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 50,
    paddingHorizontal: 18,
  },
  primaryButtonText: { fontSize: 16, fontWeight: weight('bold') },
  retryButton: {
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 40,
    paddingHorizontal: 22,
  },
  retryText: { fontSize: 14, fontWeight: weight('semibold') },
  link: { justifyContent: 'center', marginTop: 6, minHeight: 40 },
});
