import { Ionicons } from '@expo/vector-icons';
import type { DashboardDto, VocabularyWordPage } from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { InstallationCredentialUnavailableError } from '@/api/installation';
import { getDashboard, getVocabularyWords } from '@/api/practices';
import { BrandHeader, PageHeading, StatRow, TouchCard } from '@/components/brand';

import { Card } from '@/components/ui';
import { fonts, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

// react-native-web 的 Text 默认 overflow-wrap: break-word，窄封面会把单词拆成两行；只在整词之间换行。
const webWholeWords = Platform.OS === 'web'
  ? ({ wordBreak: 'normal', overflowWrap: 'normal' } as unknown as TextStyle)
  : null;

function dashboardErrorMessage(error: unknown): string {
  if (error instanceof InstallationCredentialUnavailableError) {
    return '云端词库请在 iOS 或 Android 设备上查看';
  }
  return error instanceof ApiError ? error.message : '暂时无法加载词库';
}

export default function WordsScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [dashboard, setDashboard] = useState<DashboardDto | null>(null);
  const [summary, setSummary] = useState<VocabularyWordPage['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  const loadDashboard = useCallback(async () => {
    const version = ++requestVersionRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getDashboard();
      if (requestVersionRef.current !== version) return;
      setDashboard(result);
      void getVocabularyWords({ limit: 1 }).then(page => {
        if (requestVersionRef.current === version) setSummary(page.summary);
      }).catch(() => { if (requestVersionRef.current === version) setSummary(null); });
    } catch (cause) {
      if (requestVersionRef.current === version) {
        setError(dashboardErrorMessage(cause));
      }
    } finally {
      if (requestVersionRef.current === version) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadDashboard();
    return () => { ++requestVersionRef.current; };
  }, [loadDashboard]));

  const number = (value: number | undefined) => (loading ? '—' : (value ?? '—'));

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <BrandHeader />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <PageHeading title="词库" description="每个词，都有下次见面。" />
        <View style={styles.review}>
          <Text testID="due-learning-count" style={[styles.largeCount, { color: dashboard ? theme.text : theme.textMuted }]}>{number(dashboard?.dueLearningCount)}</Text>
          <Text style={[styles.reviewLabel, { color: theme.textMuted }]}>今天待复习</Text>
          <Text style={[styles.reviewIntro, { color: theme.textSecondary }]}>在一篇新文章里，和这些词再见一面。</Text>
          <TouchCard onPress={() => router.push('/practice/from-vocabulary')} accessibilityLabel="打开 AI 阅读练习"
            style={[styles.reviewAction, { backgroundColor: theme.accent }]}>
            <Text style={[styles.reviewButton, { color: theme.accentText }]}>开始今天的练习</Text>
            <Ionicons name="arrow-forward" size={18} color={theme.accentText} />
          </TouchCard>
        </View>
        <StatRow items={[
          { label: '全部单词', value: number(dashboard?.vocabularyCount), testID: 'total-word-count' },
          { label: '正在学习', value: number(summary?.learningCount) },
          { label: '已经掌握', value: number(summary?.masteredCount) },
        ]} />
        {error ? <Card theme={theme} style={styles.stateCard}>
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => void loadDashboard()} style={[styles.retryButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>重试</Text></TouchableOpacity>
        </Card> : null}
        <View style={styles.bookHeading}><Text style={[styles.bookTitle, { color: theme.text }]}>我的生词本</Text><TouchableOpacity onPress={() => router.push('/vocabulary/book')} style={styles.link}><Text style={{ color: theme.accent }}>查看全部</Text></TouchableOpacity></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="打开生词本" onPress={() => router.push('/vocabulary/book')} style={[styles.bookRow, { borderTopColor: theme.text }]}>
          <View style={[styles.bookCover, { backgroundColor: theme.pink }]}><Text testID="vocabulary-book-cover-title" numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.75}
            style={[styles.coverText, webWholeWords, { color: theme.onPink }]}>{'Words\nin\ncontext.'}</Text></View>
          <View style={styles.entryCopy}>
            <Text style={[styles.entryTitle, { color: theme.text }]}>生词本</Text>
            <Text style={[styles.entryMeta, { color: theme.textSecondary }]}>阅读中遇见的词</Text>
            <Text style={[styles.entryMeta, { color: theme.textMuted }]}>今日新增 <Text testID="today-added-count">{number(dashboard?.todayAddedCount)}</Text> 个</Text>
            <Text style={[styles.entryHint, { color: theme.accent }]}>打开生词本  →</Text>
          </View>
        </TouchableOpacity>
        {loading && !dashboard && !error ? <ActivityIndicator color={theme.accent} style={{ marginTop: 16 }} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 12, width: '100%', maxWidth: 760, alignSelf: 'center' },
  review: { paddingBottom: 8 },
  largeCount: { fontFamily: fonts.display, fontSize: 72, lineHeight: 80 },
  reviewLabel: { fontSize: 13, marginTop: 2 },
  reviewIntro: { fontSize: 14, lineHeight: 22, marginTop: 18 },
  reviewAction: { alignSelf: 'flex-start', borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, minHeight: 46, paddingHorizontal: 18 },
  reviewButton: { fontSize: 15, fontWeight: weight('semibold') },
  bookHeading: { paddingTop: 20, marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bookTitle: { fontSize: 19, fontWeight: weight('bold') },
  link: { minHeight: 44, justifyContent: 'center' },
  bookRow: { flexDirection: 'row', gap: 20, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  bookCover: { width: 94, minHeight: 136, padding: 12, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: radius.content, borderBottomRightRadius: radius.content },
  // 封面内宽只有 70px：17px 时最长的 context. 约 66px，整词不拆行。
  coverText: { fontFamily: fonts.display, fontSize: 17, lineHeight: 22 },
  entryCopy: { flex: 1, justifyContent: 'center' },
  entryTitle: { fontSize: 17, fontWeight: weight('semibold') },
  entryMeta: { fontSize: 12, lineHeight: 20, marginTop: 8 },
  entryHint: { fontSize: 13, marginTop: 18 },
  stateCard: { alignItems: 'center', marginBottom: 10, padding: 20 },
  stateText: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retryButton: { borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center', marginTop: 14, minHeight: 44, paddingHorizontal: 22 },
});
