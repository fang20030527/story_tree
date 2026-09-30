import { Ionicons } from '@expo/vector-icons';
import type { DashboardDto, VocabularyWordPage } from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
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
import { getDashboard, getVocabularyWords } from '@/api/practices';
import { BrandHeader, PageHeading, StatRow, TouchCard } from '@/components/brand';

import { Card } from '@/components/ui';
import { fonts, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

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
        <TouchCard onPress={() => router.push('/practice/from-vocabulary')} accessibilityLabel="打开 AI 阅读练习"
          style={[styles.review, { backgroundColor: theme.reviewPink }]}>
          <Text style={styles.reviewIntro}>今天，和这些词再见一面</Text>
          <View style={styles.reviewCount}><Text testID="due-learning-count" style={styles.largeCount}>{number(dashboard?.dueLearningCount)}</Text><Text style={styles.reviewIntro}>词待复习</Text></View>
          <Text style={styles.reviewIntro}>在一篇新文章里，把它们读懂。</Text>
          <View style={styles.reviewAction}><Text style={styles.reviewButton}>开始今天的练习</Text><Ionicons name="arrow-forward" size={24} color="#FFFFFF" /></View>
        </TouchCard>
        <StatRow items={[
          { label: '全部单词', value: number(dashboard?.vocabularyCount), testID: 'total-word-count' },
          { label: '正在学习', value: number(summary?.learningCount) },
          { label: '已经掌握', value: number(summary?.masteredCount) },
        ]} />
        {error ? <Card theme={theme} style={styles.stateCard}>
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => void loadDashboard()} style={[styles.retryButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>重试</Text></TouchableOpacity>
        </Card> : null}
        <View style={[styles.bookHeading, { borderTopColor: theme.border }]}><Text style={[styles.bookTitle, { color: theme.text }]}>我的生词本</Text><TouchableOpacity onPress={() => router.push('/vocabulary/book')} style={styles.link}><Text style={{ color: theme.accent }}>查看全部</Text></TouchableOpacity></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="打开生词本" onPress={() => router.push('/vocabulary/book')} style={[styles.bookRow, { borderTopColor: theme.text }]}>
          <View style={[styles.bookCover, { backgroundColor: '#B53720' }]}><Text style={styles.coverText}>{'Words\nin\ncontext.'}</Text></View>
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
  review: { padding: 24, borderRadius: 2 },
  reviewIntro: { color: '#FFFFFF', fontSize: 13, lineHeight: 22 },
  reviewCount: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginVertical: 12 },
  largeCount: { fontFamily: fonts.display, fontSize: 100, lineHeight: 114, color: '#FFFFFF' },
  reviewAction: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0C5D3', marginTop: 24, paddingTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewButton: { color: '#FFFFFF', fontSize: 15, fontWeight: weight('semibold') },
  bookHeading: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 28, marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bookTitle: { fontSize: 20 },
  link: { minHeight: 44, justifyContent: 'center' },
  bookRow: { flexDirection: 'row', gap: 20, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  bookCover: { width: 94, minHeight: 140, padding: 12 },
  coverText: { fontFamily: fonts.display, color: '#FFFFFF', fontSize: 30, lineHeight: 28 },
  entryCopy: { flex: 1, justifyContent: 'center' },
  entryTitle: { fontSize: 17 },
  entryMeta: { fontSize: 12, lineHeight: 20, marginTop: 8 },
  entryHint: { fontSize: 13, marginTop: 18 },
  stateCard: { alignItems: 'center', marginBottom: 10, padding: 20 },
  stateText: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retryButton: { borderRadius: 4, borderWidth: 1, justifyContent: 'center', marginTop: 14, minHeight: 44, paddingHorizontal: 22 },
});
