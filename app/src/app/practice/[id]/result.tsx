import { Ionicons } from '@expo/vector-icons';
import type { PracticeDto } from '@context-reader/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { getPractice } from '@/api/practices';
import { weight } from '@/constants/theme';
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
      await clearActivePracticeId();
      router.replace('/');
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
            <TouchableOpacity
              onPress={() => {
                setError(null);
                setLoadAttempt((attempt) => attempt + 1);
              }}
              style={[styles.retryButton, { borderColor: theme.border }]}>
              <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ActivityIndicator color={theme.accent} />
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
        <View style={[styles.resultIcon, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="trophy" size={44} color={theme.accent} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>练习完成</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          首次作答结果已保存
        </Text>

        <View
          style={[
            styles.summaryCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.green }]}>{correctCount}</Text>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>答对</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.accent }]}>{assistedCount}</Text>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>使用帮助</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.text }]}>
              {practice.questions.length}
            </Text>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>总题数</Text>
          </View>
        </View>

        {error ? (
          <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
        ) : null}
        <TouchableOpacity
          disabled={leaving}
          onPress={() => void finish()}
          style={[
            styles.finishButton,
            { backgroundColor: theme.accent, opacity: leaving ? 0.65 : 1 },
          ]}>
          {leaving ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={[styles.finishText, { color: theme.accentText }]}>
              返回阅读首页
            </Text>
          )}
        </TouchableOpacity>
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
  return <ResultContent practiceId={practiceId} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  resultIcon: {
    alignItems: 'center',
    borderRadius: 44,
    height: 88,
    justifyContent: 'center',
    width: 88,
  },
  title: { fontSize: 27, fontWeight: weight('bold'), marginTop: 20 },
  subtitle: { fontSize: 14, marginTop: 8 },
  summaryCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginTop: 30,
    paddingVertical: 20,
    width: '100%',
  },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 28, fontWeight: weight('bold') },
  statLabel: { fontSize: 12, marginTop: 5 },
  divider: { height: 38, width: StyleSheet.hairlineWidth },
  finishButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 28,
    minHeight: 52,
    width: '100%',
  },
  finishText: { fontSize: 16, fontWeight: weight('bold') },
  errorText: { fontSize: 13, lineHeight: 20, marginTop: 14, textAlign: 'center' },
  retryButton: {
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 24,
  },
  retryText: { fontSize: 14, fontWeight: weight('semibold') },
});
