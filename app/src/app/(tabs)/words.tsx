import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Chip } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { words } from '@/data/mock';

const FILTERS = ['全部', '待复习', '复习中', '已掌握'] as const;

export default function WordsScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部');

  const filtered = words.filter((w) => filter === '全部' || w.status === filter);
  const dueToday = words.filter(
    (w) => w.due.includes('今天') || w.due.includes('逾期')
  ).length;

  const statusColor = (s: string) =>
    s === '已掌握' ? theme.green : s === '复习中' ? theme.accent : theme.blue;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>词库</Text>
        <TouchableOpacity
          style={[styles.headerButton, { borderColor: theme.border }]}
          hitSlop={8}>
          <Ionicons name="add" size={20} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}>
        <Card theme={theme} style={styles.summary}>
          <View>
            <Text style={[styles.summaryNum, { color: theme.text }]}>{dueToday}</Text>
            <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
              个义项今天到期
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.reviewButton, { backgroundColor: theme.accent }]}
            activeOpacity={0.85}>
            <Ionicons name="play" size={14} color={theme.accentText} />
            <Text style={[styles.reviewButtonText, { color: theme.accentText }]}>
              开始今日复习
            </Text>
          </TouchableOpacity>
        </Card>
        <Text style={[styles.summaryHint, { color: theme.textMuted }]}>
          复习会以一篇全新主题的长文呈现，目标词轻度高亮但不直接显示释义
        </Text>

        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === f ? theme.accentSoft : theme.surface,
                  borderColor: filter === f ? theme.accent : theme.border,
                },
              ]}>
              <Text
                style={{
                  color: filter === f ? theme.accent : theme.textSecondary,
                  fontSize: 13,
                  fontWeight: weight(filter === f ? 'semibold' : 'regular'),
                }}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {filtered.map((w) => (
          <TouchableOpacity key={w.word} activeOpacity={0.8}>
            <Card theme={theme} style={styles.wordCard}>
              <View style={styles.wordHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.word, { color: theme.text }]}>{w.word}</Text>
                  <Text style={[styles.meaning, { color: theme.accent }]}>
                    {w.meaning}
                  </Text>
                </View>
                <Chip
                  label={w.status}
                  color={statusColor(w.status)}
                  bg={theme.accentSoft}
                />
              </View>
              <Text
                style={[styles.context, { color: theme.textSecondary }]}
                numberOfLines={2}>
                {w.context}
              </Text>
              <View style={styles.wordFooter}>
                <Text style={[styles.source, { color: theme.textMuted }]}>
                  来源 {w.source}
                </Text>
                <Text
                  style={[
                    styles.due,
                    { color: w.due.includes('逾期') ? theme.danger : theme.textMuted },
                  ]}>
                  {w.due}
                </Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: weight('bold') },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
  },
  summaryNum: { fontSize: 32, fontWeight: weight('bold') },
  summaryLabel: { fontSize: 13, marginTop: 2 },
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  reviewButtonText: { fontSize: 14, fontWeight: weight('bold') },
  summaryHint: { fontSize: 12, lineHeight: 17, marginTop: 10, marginBottom: 4 },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 12 },
  filterChip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  wordCard: { padding: 14, marginBottom: 10 },
  wordHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  word: { fontSize: 17, fontWeight: weight('bold') },
  meaning: { fontSize: 13, marginTop: 3, fontWeight: weight('medium') },
  context: { fontSize: 13, lineHeight: 19, marginTop: 8, fontStyle: 'italic' },
  wordFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  source: { fontSize: 12 },
  due: { fontSize: 12 },
});
