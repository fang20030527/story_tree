import { Ionicons } from '@expo/vector-icons';
import type { AnswerResult, PracticeDto } from '@context-reader/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { getPractice, submitAnswer } from '@/api/practices';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { QuizQuestion } from '@/features/practice/QuizQuestion';

function safeLoadError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : '暂时无法加载测验，请重试';
}

function QuizContent({ practiceId }: { practiceId: string }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [practice, setPractice] = useState<PracticeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

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
        const nextQuestion = nextPractice.questions.find(
          (question) => question.submittedAnswer === null,
        );
        if (!nextQuestion) {
          router.replace({
            pathname: '/practice/[id]/result',
            params: { id: practiceId },
          });
          return;
        }
        setPractice(nextPractice);
      })
      .catch((nextError: unknown) => {
        if (mounted) setError(safeLoadError(nextError));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [loadAttempt, practiceId]);

  const reload = () => {
    setLoading(true);
    setError(null);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const question = practice?.questions.find(
    (candidate) => candidate.submittedAnswer === null,
  );
  const answeredCount = practice?.questions.filter(
    (candidate) => candidate.submittedAnswer !== null,
  ).length ?? 0;

  const submitCurrentAnswer = async (
    answer:
      | { answerKind: 'option'; selectedOptionId: string }
      | { answerKind: 'dont_know' },
    elapsedMs: number,
    idempotencyKey: string,
  ): Promise<AnswerResult> => {
    if (!question) {
      throw new ApiError('STATE_CONFLICT', '题目状态已变化', false);
    }
    return answer.answerKind === 'option'
      ? submitAnswer(
          practiceId,
          {
            answerKind: 'option',
            questionId: question.id,
            selectedOptionId: answer.selectedOptionId,
            elapsedMs,
          },
          idempotencyKey,
        )
      : submitAnswer(
          practiceId,
          {
            answerKind: 'dont_know',
            questionId: question.id,
            elapsedMs,
          },
          idempotencyKey,
        );
  };

  if (loading && !practice) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (error || !practice || !question) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <Text style={[styles.errorText, { color: theme.danger }]}>
          {error ?? '暂时无法加载题目'}
        </Text>
        <TouchableOpacity
          onPress={reload}
          style={[styles.retryButton, { borderColor: theme.border }]}>
          <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity
          accessibilityLabel="返回阅读"
          hitSlop={8}
          onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>词义测验</Text>
          <Text style={[styles.progress, { color: theme.textMuted }]}>
            {answeredCount + 1}/{practice.questions.length}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}>
        <QuizQuestion
          key={question.id}
          onContinue={reload}
          onSubmit={submitCurrentAnswer}
          question={question}
        />
      </ScrollView>
    </View>
  );
}

export default function PracticeQuizScreen() {
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
  return <QuizContent practiceId={practiceId} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 16,
  },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  progress: { fontSize: 12, marginTop: 2 },
  headerSpacer: { width: 26 },
  content: { paddingHorizontal: 18, paddingTop: 24 },
  errorText: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
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
