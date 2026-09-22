import type {
  AnswerResult,
  PublicQuestion,
} from '@context-reader/contracts';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { InteractiveWordParagraph } from './ArticleParagraph';
import { useSavedVocabularyWords } from './useSavedVocabularyWords';
import { createVocabularyItem } from '@/api/practices';

import { isEnglishSelfTest } from './isEnglishSelfTest';

import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

interface QuizQuestionProps {
  question: PublicQuestion;
  onSubmit: (
    answer:
      | { answerKind: 'option'; selectedOptionId: string }
      | { answerKind: 'dont_know' },
    elapsedMs: number,
    idempotencyKey: string,
  ) => Promise<AnswerResult>;
  onContinue: () => void;
  continueLabel?: string | undefined;
}

export function QuizQuestion({
  question,
  onContinue,
  onSubmit,
  continueLabel,
}: QuizQuestionProps) {
  const { theme } = useAppTheme();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(
    question.submittedAnswer?.selectedOptionId ?? null,
  );
  const [feedback, setFeedback] = useState<AnswerResult | null>(
    question.submittedAnswer,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [idempotencyKey] = useState(() => createIdempotencyKey());
  const submissionRef = useRef<Promise<void> | null>(null);
  const englishSelfTest = isEnglishSelfTest(question);
  const locked = feedback !== null || submitting;
  const { addedWords, handleWordAdded } = useSavedVocabularyWords(feedback ? question.id : undefined);
  const feedbackText = (text: string, style: React.ComponentProps<typeof Text>['style']) => (
    <InteractiveWordParagraph
      text={text}
      textStyle={[{ marginBottom: 0 }, style]}
      addedWords={addedWords}
      onWordAdded={handleWordAdded}
      onAddToVocabulary={async (input, key) => { await createVocabularyItem(input, key); }}
      targetColor={theme.accent}
      addedWordColor={theme.accent}
      surfaceColor={theme.surfaceAlt}
      borderColor={theme.border}
      mutedColor={theme.textSecondary}
      dangerColor={theme.danger}
    />
  );

  const submit = (
    answer:
      | { answerKind: 'option'; selectedOptionId: string }
      | { answerKind: 'dont_know' },
  ): Promise<void> => {
    if (feedback || submissionRef.current) {
      return submissionRef.current ?? Promise.resolve();
    }

    setSubmitting(true);
    setSubmitError(null);
    const operation = (async () => {
      try {
        const key = await idempotencyKey;
        const elapsedMs = Math.min(
          3_600_000,
          Math.max(0, Date.now() - startedAt),
        );
        setFeedback(await onSubmit(answer, elapsedMs, key));
      } catch (error) {
        setSubmitError(
          error instanceof ApiError
            ? error.message
            : '暂时无法提交答案，请重试',
        );
      } finally {
        setSubmitting(false);
      }
    })().finally(() => {
      if (submissionRef.current === operation) submissionRef.current = null;
    });
    submissionRef.current = operation;
    return operation;
  };

  return (
    <View>
      <Text style={[styles.term, { color: theme.accent }]}>
        {englishSelfTest ? 'Choose the word that best completes the sentence.' : question.term}
      </Text>
      {feedback
        ? feedbackText(question.prompt, [styles.prompt, { color: theme.text }])
        : <Text style={[styles.prompt, { color: theme.text }]}>{question.prompt}</Text>}

      <View style={styles.options}>
        {question.options.map((option) => {
          const selected = option.id === selectedOptionId;
          const correct = feedback?.correctOptionId === option.id;
          const selectedWrong = Boolean(
            feedback
            && selected
            && !correct,
          );
          const OptionContainer = feedback ? View : TouchableOpacity;
          return (
            <OptionContainer
              accessibilityRole={feedback ? undefined : 'radio'}
              accessibilityState={feedback ? undefined : { disabled: locked, selected }}
              disabled={feedback ? undefined : locked}
              key={option.id}
              onPress={feedback ? undefined : () => setSelectedOptionId(option.id)}
              style={[
                styles.option,
                {
                  backgroundColor: correct
                    ? `${theme.green}18`
                    : selectedWrong
                      ? `${theme.danger}14`
                      : selected
                        ? theme.accentSoft
                        : theme.surface,
                  borderColor: correct
                    ? theme.green
                    : selectedWrong
                      ? theme.danger
                      : selected
                        ? theme.accent
                        : theme.border,
                },
              ]}>
              {feedback
                ? feedbackText(option.label, [styles.optionText, { color: theme.text }])
                : <Text style={[styles.optionText, { color: theme.text }]}>{option.label}</Text>}
              {feedback?.optionExplanations[option.id] ? (
                feedbackText(feedback.optionExplanations[option.id]!, [
                  styles.optionExplanation, { color: theme.textSecondary },
                ])
              ) : null}
            </OptionContainer>
          );
        })}
      </View>

      {feedback ? (
        <View
          style={[
            styles.feedback,
            { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}>
          <Text
            style={[
              styles.feedbackTitle,
              { color: feedback.isCorrect ? theme.green : theme.text },
            ]}>
            {feedback.isCorrect ? '回答正确' : (englishSelfTest ? '正确答案已标出' : '正确义项已标出')}
          </Text>
          {!englishSelfTest ? (
            <Text style={[styles.meaningEn, { color: theme.textSecondary }]}>
              {feedback.meaningEn}
            </Text>
          ) : null}
          <Text style={[styles.explanation, { color: theme.text }]}>
            {feedback.explanationZh}
          </Text>
          <TouchableOpacity
            onPress={onContinue}
            style={[styles.primaryButton, { backgroundColor: theme.accent }]}>
            <Text style={[styles.primaryText, { color: theme.accentText }]}>{continueLabel ?? '继续'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TouchableOpacity
            accessibilityLabel={englishSelfTest ? 'Check answer' : '提交答案'}
            disabled={!selectedOptionId || submitting}
            onPress={() => selectedOptionId
              ? submit({ answerKind: 'option', selectedOptionId })
              : undefined}
            style={[
              styles.primaryButton,
              {
                backgroundColor: theme.accent,
                opacity: !selectedOptionId || submitting ? 0.5 : 1,
              },
            ]}>
            {submitting ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <Text style={[styles.primaryText, { color: theme.accentText }]}>
                {englishSelfTest ? 'Check answer' : '提交答案'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            disabled={submitting}
            onPress={() => submit({ answerKind: 'dont_know' })}
            style={styles.dontKnowButton}>
            <Text style={[styles.dontKnowText, { color: theme.textSecondary }]}>
              {englishSelfTest ? "I don't know" : '我不知道'}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {submitError ? (
        <Text style={[styles.submitError, { color: theme.danger }]}>
          {submitError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  term: { fontSize: 15, fontWeight: weight('bold') },
  prompt: { fontSize: 22, fontWeight: weight('bold'), lineHeight: 31, marginTop: 8 },
  options: { gap: 10, marginTop: 24 },
  option: {
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionText: { fontSize: 15, lineHeight: 22 },
  optionExplanation: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 50,
  },
  primaryText: { fontSize: 16, fontWeight: weight('bold') },
  dontKnowButton: { alignItems: 'center', marginTop: 12, padding: 10 },
  dontKnowText: { fontSize: 14, fontWeight: weight('medium') },
  feedback: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 20,
    padding: 16,
  },
  feedbackTitle: { fontSize: 17, fontWeight: weight('bold') },
  meaningEn: { fontSize: 13, fontStyle: 'italic', marginTop: 6 },
  explanation: { fontSize: 14, lineHeight: 22, marginTop: 10 },
  submitError: { fontSize: 13, marginTop: 10, textAlign: 'center' },
});
