import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { createPractice, getDashboard, registerAnonymous } from '@/api/practices';
import { PrimaryAction, SecondaryAction, SectionHeading, TextAction } from '@/components/subpage';
import { PageHeading } from '@/components/brand';
import { fonts, orbitTilt, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { ContinuePracticeCard } from '@/features/practice/ContinuePracticeCard';
import { PracticePreferencesCard } from '@/features/practice/PracticePreferencesCard';
import { loadPracticeTargetCount } from '@/features/practice/practicePreferences';
import {
  clearCreatePracticeOperation, loadCreatePracticeOperation,
  prepareCreatePracticeOperation, saveActivePracticeId,
} from '@/features/practice/practiceStorage';

type CandidateStats = { dueLearningCount: number; unlearnedCount: number };

function statsErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '暂时无法加载可练习单词数量';
}

export default function VocabularyPracticeSetupScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
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

  // Only called from the start button, never on mount:
  // entering this page must not create a practice or spend quota.
  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
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
        <PageHeading title="把单词，放回文章里。" description="换一个语境，让记忆多一个落点。" />
        <View style={[styles.modeRow, { borderColor: theme.border }]}><View style={{ flex: 1 }}><View style={styles.modeName}><Text style={{ color: theme.text, fontSize: 16, fontWeight: weight('semibold') }}>智能选词</Text><View style={[styles.modeMark, { backgroundColor: theme.vermilion }]} /></View><Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 20, marginTop: 5 }}>按照记忆曲线，自动安排本次复习。</Text></View><TouchableOpacity accessibilityRole="button" onPress={() => router.push('/practice/select-words')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent, fontWeight: weight('semibold') }}>自定义选词 →</Text></TouchableOpacity></View>
        <ContinuePracticeCard />
        <PracticePreferencesCard />
        <View style={styles.statsCard}>
          <SectionHeading title="本次自动选词" style={styles.statsHeading} />
          {statsLoading && !stats ? (
            <View style={styles.statsLoading}>
              <ActivityIndicator color={theme.textMuted} size="small" />
              <Text style={[styles.statsHint, { color: theme.textMuted }]}>正在统计可练习单词…</Text>
            </View>
          ) : null}
          {stats ? (
            <View style={styles.statsNumbers}>
              <View><Text testID="due-learning-count" style={[styles.statsNumber, { color: theme.text }]}>{stats.dueLearningCount}</Text><Text style={[styles.statsLabel, { color: theme.textMuted }]}>到期在学</Text></View>
              <View><Text testID="unlearned-count" style={[styles.statsNumber, { color: theme.text }]}>{stats.unlearnedCount}</Text><Text style={[styles.statsLabel, { color: theme.textMuted }]}>未学</Text></View>
            </View>
          ) : null}
          <Text style={[styles.statsHint, { color: theme.textMuted }]}>
            优先选择到期的在学词，再用未学词补足目标数量；未到期和已掌握的单词不会进入练习。
          </Text>
          {statsError ? (
            <View style={styles.statsError}>
              <Text style={[styles.statsHint, { color: theme.danger }]}>{statsError}</Text>
              <SecondaryAction label="重试" onPress={() => void loadStats()} style={{ marginTop: 10 }} />
            </View>
          ) : null}
        </View>
        {candidates === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>暂无可练习的单词</Text>
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
              生词本里还没有到期或未学的单词。可以先录入新单词，或等复习时间到达后再来。
            </Text>
            <View style={styles.emptyActions}>
              <SecondaryAction label="录入新单词" onPress={() => router.push('/practice/new')} />
              <TextAction label="查看生词本" onPress={() => router.push('/vocabulary/book')} />
            </View>
          </View>
        ) : null}
        {message ? (
          <View style={styles.messageArea}>
            <Text style={[styles.emptyBody, { color: theme.danger }]}>{message}</Text>
            {!submitting ? (
              <SecondaryAction label="重试" onPress={() => void start()} style={{ marginTop: 10 }} />
            ) : null}
          </View>
        ) : null}
        {candidates !== null && candidates > 0 ? (
          <PrimaryAction label="开始多情景阅读练习" accessibilityLabel={submitting ? '正在创建练习' : '开始多情景阅读练习'} busy={submitting} onPress={() => void start()} style={styles.primaryButton} arrow />
        ) : null}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 22 },
  screen: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center',  padding: 16, paddingBottom: 28, gap: 14  },
  modeName: { alignSelf: 'flex-start', alignItems: 'center', gap: 5 },
  modeMark: { width: 12, height: 4, borderRadius: '50%', transform: [{ rotate: orbitTilt }] },
  statsCard: { gap: 10 },
  statsHeading: { marginTop: 4 },
  statsNumbers: { flexDirection: 'row', gap: 36, marginTop: 4 },
  statsNumber: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46 },
  statsLabel: { fontSize: 12, marginTop: 2 },
  statsHint: { fontSize: 12, lineHeight: 19 },
  statsLoading: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  statsError: { alignItems: 'flex-start' },
  emptyCard: { gap: 8, paddingVertical: 8 },
  emptyTitle: { fontSize: 17, fontWeight: weight('semibold') },
  emptyBody: { fontSize: 13, lineHeight: 21 },
  emptyActions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 6 },
  messageArea: { alignItems: 'flex-start', gap: 4 },
  primaryButton: { marginTop: 12 },
});
