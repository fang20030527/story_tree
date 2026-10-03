import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressFeedback } from '@/components/motion';

import { getDashboard, getPractice } from '@/api/practices';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { destinationForPractice, type PracticeDestination } from './resumePractice';
import { loadActivePracticeId } from './practiceStorage';

export function ContinuePracticeCard() {
  const { theme } = useAppTheme();
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [destination, setDestination] = useState<PracticeDestination>('topics');
  useFocusEffect(useCallback(() => {
    let current = true;
    void (async () => {
      try {
        const localId = await loadActivePracticeId();
        const candidates = [localId];
        for (let index = 0; index < 2; index += 1) {
          if (index === 1) candidates.push((await getDashboard()).incompletePracticeId);
          const id = candidates[index];
          if (!id || (index === 1 && id === localId)) continue;
          const practice = await getPractice(id).catch(() => null);
          if (!practice) continue;
          const hasIncomplete = practice.group
            ? practice.group.articles.some((article) => article.status !== 'failed' && article.status !== 'completed')
            : practice.status !== 'failed' && practice.status !== 'completed';
          if (!hasIncomplete) continue;
          if (current) {
            setPracticeId(practice.group?.id ?? id);
            setDestination(destinationForPractice(practice));
          }
          return;
        }
        if (current) setPracticeId(null);
      } catch {
        if (current) setPracticeId(null);
      }
    })();
    return () => { current = false; };
  }, []));
  if (!practiceId) return null;
  return (
    <PressFeedback
      accessibilityRole="button"
      accessibilityLabel={destination === 'topics' ? '继续主题短文' : '继续练习'}
      onPress={() => destination === 'new' ? router.push('/practice/new') : router.push({ pathname: `/practice/[id]/${destination}`, params: { id: practiceId } })}
      style={[styles.card, { backgroundColor: theme.surfaceAlt }]}>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: theme.textMuted }]}>未完成的练习</Text>
        <Text style={[styles.title, { color: theme.text }]}>{destination === 'topics' ? '继续主题短文' : '继续练习'}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{destination === 'topics' ? '回到四个主题，选择下一篇' : '接着上次的阅读和答题进度继续'}</Text>
      </View>
      <Text style={[styles.go, { color: theme.accent }]}>继续 →</Text>
    </PressFeedback>
  );
}
const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, borderRadius: 20, padding: 16, marginBottom: 20 },
  copy: { flex: 1, gap: 4 },
  label: { fontSize: 12.5 },
  title: { fontSize: 17, fontWeight: weight('semibold') },
  subtitle: { fontSize: 12, lineHeight: 18 },
  go: { fontSize: 14, fontWeight: weight('semibold'), paddingBottom: 2 },
});
