import { Ionicons } from '@expo/vector-icons';
import type { DashboardDto } from '@context-reader/contracts';
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
import { getDashboard } from '@/api/practices';
import { Card } from '@/components/ui';
import { weight } from '@/constants/theme';
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
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>词库</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}>
        {error ? (
          <Card theme={theme} style={styles.stateCard}>
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>{error}</Text>
            <TouchableOpacity
              onPress={() => void loadDashboard()}
              style={[styles.retryButton, { borderColor: theme.border }]}>
              <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
            </TouchableOpacity>
          </Card>
        ) : null}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="打开生词本"
          activeOpacity={0.85}
          onPress={() => router.push('/vocabulary/book')}>
          <Card theme={theme} style={styles.entryCard}>
            <View style={[styles.entryIcon, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="book-outline" size={26} color={theme.accent} />
            </View>
            <View style={styles.entryCopy}>
              <Text style={[styles.entryTitle, { color: theme.text }]}>生词本</Text>
              <Text style={[styles.entryMeta, { color: theme.textSecondary }]}>
                <Text testID="total-word-count">{number(dashboard?.vocabularyCount)}</Text>
                {' 个单词 · 今日新增 '}
                <Text testID="today-added-count">{number(dashboard?.todayAddedCount)}</Text>
              </Text>
              <Text style={[styles.entryHint, { color: theme.textMuted }]}>
                按今日新增、在学、未学和已掌握浏览全部单词
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </Card>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="打开 AI 阅读练习"
          activeOpacity={0.85}
          onPress={() => router.push('/practice/from-vocabulary')}>
          <Card theme={theme} style={styles.entryCard}>
            <View style={[styles.entryIcon, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="sparkles" size={24} color={theme.accent} />
            </View>
            <View style={styles.entryCopy}>
              <Text style={[styles.entryTitle, { color: theme.text }]}>AI 阅读练习</Text>
              <Text style={[styles.entryMeta, { color: theme.textSecondary }]}>
                <Text testID="due-learning-count">{number(dashboard?.dueLearningCount)}</Text>
                {' 个到期在学单词待复习'}
              </Text>
              <Text style={[styles.entryHint, { color: theme.textMuted }]}>
                生成 4 篇不同主题的短文，在阅读中练习这些单词
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </Card>
        </TouchableOpacity>
        {loading && !dashboard && !error ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.accent} size="small" />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: weight('bold') },
  content: { paddingHorizontal: 16 },
  entryCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
    padding: 18,
  },
  entryIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  entryCopy: { flex: 1 },
  entryTitle: { fontSize: 17, fontWeight: weight('bold') },
  entryMeta: { fontSize: 13, fontWeight: weight('medium'), marginTop: 5 },
  entryHint: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  stateCard: { alignItems: 'center', marginTop: 14, padding: 28 },
  stateText: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retryButton: {
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 40,
    paddingHorizontal: 22,
  },
  retryText: { fontSize: 14, fontWeight: weight('semibold') },
  loadingRow: { alignItems: 'center', paddingVertical: 20 },
});
