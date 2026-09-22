import { useStudyTimer } from '@/features/study/useStudyTimer';
import { usePracticeExitGuard } from '@/features/practice/usePracticeExitGuard';
import { Ionicons } from '@expo/vector-icons';
import type { AnswerResult, PracticeDto } from '@context-reader/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { QuizArticleReference } from '@/features/practice/QuizArticleReference';
import { isEnglishSelfTest } from '@/features/practice/isEnglishSelfTest';
import { ReadingOverlayProvider } from '@/features/practice/ReadingOverlay';
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
  const completed = Boolean(practice?.questions.length
    && practice.questions.every((question) => question.submittedAnswer !== null));
  const allowNavigation = usePracticeExitGuard(practiceId, practice !== null && !completed);
  const [mode, setMode] = useState<'review' | 'retry'>('review');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [retryAnswers, setRetryAnswers] = useState<Record<string, AnswerResult>>({});
  const [retryScore, setRetryScore] = useState<number | null>(null);
  const advancingFirstAttempt = useRef(false);
  const [loading, setLoading] = useState(true);
  useStudyTimer(practice !== null && !loading);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const reloadPractice = () => {
    setLoading(true);
    setError(null);
    setLoadAttempt((attempt) => attempt + 1);
  };

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
          allowNavigation(() => router.replace({
            pathname: '/practice/[id]/generating',
            params: { id: practiceId },
          }));
          return;
        }
        const nextQuestion = nextPractice.questions.find(
          (question) => question.submittedAnswer === null,
        );
        if (!nextQuestion && advancingFirstAttempt.current) {
          allowNavigation(() => router.replace({
            pathname: '/practice/[id]/result',
            params: { id: practiceId },
          }));
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
  }, [allowNavigation, loadAttempt, practiceId]);

  const storedQuestion = completed
    ? practice?.questions[questionIndex]
    : practice?.questions.find((candidate) => candidate.submittedAnswer === null);
  const question = storedQuestion && completed && mode === 'retry'
    ? { ...storedQuestion, submittedAnswer: retryAnswers[storedQuestion.id] ?? null }
    : storedQuestion;
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
    if (completed && mode === 'retry' && storedQuestion?.submittedAnswer) {
      const original = storedQuestion.submittedAnswer;
      const feedback = {
        wasAssisted: false,
        correctOptionId: original.correctOptionId,
        meaningEn: original.meaningEn,
        explanationZh: original.explanationZh,
        optionExplanations: original.optionExplanations,
      };
      const result: AnswerResult = answer.answerKind === 'option'
        ? { ...feedback, ...answer, isCorrect: answer.selectedOptionId === original.correctOptionId }
        : { ...feedback, answerKind: 'dont_know', selectedOptionId: null, isCorrect: false };
      setRetryAnswers((answers) => ({ ...answers, [question.id]: result }));
      return result;
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

  if (error || !practice || !practice.article || !question) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <Text style={[styles.errorText, { color: theme.danger }]}>
          {error ?? '暂时无法加载题目'}
        </Text>
        <TouchableOpacity
          onPress={reloadPractice}
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
          <Text style={[styles.headerTitle, { color: theme.text }]}>{isEnglishSelfTest(question) ? 'Vocabulary self-test' : '词义测验'}</Text>
          <Text style={[styles.progress, { color: theme.textMuted }]}>
            {completed ? questionIndex + 1 : answeredCount + 1}/{practice.questions.length}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.splitContent} testID="quiz-split-content">
        {!isEnglishSelfTest(question) && <QuizArticleReference
          activeTargetId={question.targetId}
          key={question.targetId}
          paragraphs={practice.article.paragraphs}
          title={practice.article.title}
        />}

        <View
          style={[
            styles.questionPane,
            { backgroundColor: theme.bg, borderTopColor: theme.border },
          ]}
          testID="quiz-question-pane">
          <ScrollView
            contentContainerStyle={[
              styles.questionContent,
              { paddingBottom: insets.bottom + 28 },
            ]}
            key={`${mode}-${question.id}`}
            showsVerticalScrollIndicator={false}
            style={styles.questionScroll}
            testID="quiz-question-scroll">
            {completed && (
              <View style={styles.reviewControls}>
                <Text style={{ color: theme.textSecondary }}>
                  {mode === 'retry' ? '重新自测 · 本轮结果不覆盖首次成绩' : '回看题目 · 首次作答与解析'}
                </Text>
                {retryScore !== null && <Text style={{ color: theme.green }}>
                  本轮完成，答对 {retryScore}/{practice.questions.length} 题
                </Text>}
                {mode === 'review' && <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => {
                    setRetryAnswers({});
                    setRetryScore(null);
                    setQuestionIndex(0);
                    setMode('retry');
                  }}
                  style={[styles.retryButton, { borderColor: theme.accent }]}>
                  <Text style={[styles.retryText, { color: theme.accent }]}>再练一次</Text>
                </TouchableOpacity>}
                {mode === 'review' && questionIndex > 0 && <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setQuestionIndex((index) => index - 1)}
                  style={[styles.retryButton, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.text }}>上一题</Text>
                </TouchableOpacity>}
              </View>
            )}
            <QuizQuestion
              continueLabel={completed
                ? (questionIndex < practice.questions.length - 1 ? '下一题' : mode === 'retry' ? '完成本轮' : '查看结果')
                : undefined}
              onContinue={() => {
                if (!completed) {
                  advancingFirstAttempt.current = true;
                  return reloadPractice();
                }
                if (questionIndex < practice.questions.length - 1) {
                  setQuestionIndex((index) => index + 1);
                } else if (mode === 'retry') {
                  setRetryScore(Object.values(retryAnswers).filter((answer) => answer.isCorrect).length);
                  setMode('review');
                  setQuestionIndex(0);
                } else {
                  allowNavigation(() => router.replace({ pathname: '/practice/[id]/result', params: { id: practiceId } }));
                }
              }}
              onSubmit={submitCurrentAnswer}
              question={question}
            />
          </ScrollView>
        </View>
      </View>
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
  return <ReadingOverlayProvider><QuizContent key={practiceId} practiceId={practiceId} /></ReadingOverlayProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  reviewControls: { gap: 8, marginBottom: 24 },
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
  splitContent: { flex: 1, minHeight: 0 },
  questionPane: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flex: 1,
    minHeight: 0,
  },
  questionScroll: { flex: 1 },
  questionContent: { paddingHorizontal: 18, paddingTop: 20 },
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
