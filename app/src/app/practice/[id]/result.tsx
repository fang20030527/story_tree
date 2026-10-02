import type { PracticeDto } from '@context-reader/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { getPractice } from '@/api/practices';
import { StatRow } from '@/components/brand';
import { FadeIn } from '@/components/motion';
import { PrimaryAction, SecondaryAction, TextAction } from '@/components/subpage';
import { fonts, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { clearActivePracticeId } from '@/features/practice/practiceStorage';

function safeLoadError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : '暂时无法加载练习结果';
}

function ResultContent({ practiceId }: { practiceId: string }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [practice, setPractice] = useState<PracticeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    getPractice(practiceId)
      .then((nextPractice) => {
        if (!mounted) return;
        if (
          nextPractice.status === 'queued'
          || nextPractice.status === 'generating'
          || nextPractice.status === 'validating'
          || nextPractice.status === 'failed'
        ) {
          router.replace({
            pathname: '/practice/[id]/generating',
            params: { id: practiceId },
          });
          return;
        }
        if (nextPractice.questions.some(
          (question) => question.submittedAnswer === null,
        )) {
          router.replace({
            pathname: '/practice/[id]/quiz',
            params: { id: practiceId },
          });
          return;
        }
        setPractice(nextPractice);
      })
      .catch((nextError: unknown) => {
        if (mounted) setError(safeLoadError(nextError));
      });
    return () => {
      mounted = false;
    };
  }, [loadAttempt, practiceId]);

  const finish = async () => {
    setLeaving(true);
    setError(null);
    try {
      if (practice?.group) {
        router.replace({ pathname: '/practice/[id]/topics', params: { id: practice.group.id } });
      } else {
        await clearActivePracticeId();
        router.replace('/');
      }
    } catch {
      setError('暂时无法保存完成状态，请重试');
    } finally {
      setLeaving(false);
    }
  };

  if (!practice) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        {error ? (
          <>
            <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
            <SecondaryAction label="重试" onPress={() => {
              setError(null);
              setLoadAttempt((attempt) => attempt + 1);
            }} />
          </>
        ) : (
          <ActivityIndicator accessibilityLabel="正在加载练习结果" color={theme.accent} />
        )}
      </View>
    );
  }

  const submittedAnswers = practice.questions.flatMap((question) => (
    question.submittedAnswer ? [question.submittedAnswer] : []
  ));
  const correctCount = submittedAnswers.filter((answer) => answer.isCorrect).length;
  const assistedCount = submittedAnswers.filter((answer) => answer.wasAssisted).length;

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: theme.bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}>
      <View style={styles.content}>
        <FadeIn>
          <Text style={[styles.eyebrow, { color: theme.textMuted }]}>PRACTICE COMPLETE</Text>
          <Text style={[styles.title, { color: theme.text }]}>练习完成</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            首次作答结果已保存
          </Text>
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { color: theme.text }]}>{correctCount}</Text>
            <Text style={[styles.scoreTotal, { color: theme.textMuted }]}>/ {practice.questions.length}</Text>
          </View>
        </FadeIn>
        <FadeIn delay={120}>
          <StatRow items={[
            { label: '答对', value: correctCount },
            { label: '使用帮助', value: assistedCount },
            { label: '总题数', value: practice.questions.length },
          ]} />
        </FadeIn>
        <View style={styles.spacer} />
        {error ? (
          <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
        ) : null}
        <PrimaryAction label={practice.group ? '返回主题选择' : '返回阅读首页'} busy={leaving} onPress={() => void finish()} />
        <TextAction label="回看题目 / 再练一次" onPress={() => router.replace({ pathname: '/practice/[id]/quiz', params: { id: practiceId } })} style={styles.review} />
      </View>
    </View>
  );
}

export default function PracticeResultScreen() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const practiceId = typeof id === 'string' ? id : null;

  if (!practiceId) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <Text style={[styles.errorText, { color: theme.danger }]}>练习地址无效</Text>
      </View>
    );
  }
  return <ResultContent key={practiceId} practiceId={practiceId} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', flex: 1, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 20 },
  eyebrow: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 1.6 },
  title: { fontSize: 28, fontWeight: weight('bold'), marginTop: 8 },
  subtitle: { fontSize: 14, marginTop: 6 },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 28 },
  score: { fontFamily: fonts.display, fontSize: 96, lineHeight: 104 },
  scoreTotal: { fontFamily: fonts.display, fontSize: 28 },
  spacer: { flex: 1, minHeight: 24 },
  review: { alignSelf: 'center', marginTop: 6 },
  errorText: { fontSize: 13, lineHeight: 20, marginBottom: 12, textAlign: 'center' },
});
