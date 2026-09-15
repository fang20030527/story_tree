import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { createPractice, registerAnonymous } from '@/api/practices';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { VocabularyInputList } from '@/features/practice/VocabularyInputList';
import {
  type VocabularyDraftRow,
  validateVocabularyDraft,
} from '@/features/practice/practiceDraft';
import {
  EMPTY_VOCABULARY_DRAFT,
  PendingCreateOperationError,
  hasConfirmedAge,
  loadCreatePracticeOperation,
  loadVocabularyDraft,
  prepareCreatePracticeOperation,
  requestToVocabularyDraft,
  saveActivePracticeId,
  saveAgeConfirmation,
  saveVocabularyDraft,
} from '@/features/practice/practiceStorage';

function publicErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof PendingCreateOperationError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '暂时无法创建练习，请稍后重试';
}

export default function NewPracticeScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [ageConfirmed, setAgeConfirmed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<VocabularyDraftRow[]>(
    () => EMPTY_VOCABULARY_DRAFT.map((row) => ({ ...row })),
  );
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([hasConfirmedAge(), loadVocabularyDraft()])
      .then(([confirmed, storedRows]) => {
        if (!mounted) return;
        setAgeConfirmed(confirmed);
        setRows(storedRows);
        setDraftLoaded(true);
      })
      .catch(() => {
        if (!mounted) return;
        setAgeConfirmed(false);
        setDraftLoaded(true);
        setMessage('暂时无法读取本地草稿');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const confirmAge = async () => {
    setMessage(null);
    try {
      await saveAgeConfirmation();
      setAgeConfirmed(true);
    } catch {
      setMessage('暂时无法保存年龄确认，请重试');
    }
  };

  const updateRows = (nextRows: VocabularyDraftRow[]) => {
    setRows(nextRows);
    setMessage(null);
    if (!draftLoaded) return;
    void saveVocabularyDraft(nextRows).catch(() => {
      setMessage('草稿保存失败，请检查设备存储后重试');
    });
  };

  const restorePendingOperation = async () => {
    const operation = await loadCreatePracticeOperation();
    if (!operation) return;
    if (!('items' in operation.request)) {
      throw new PendingCreateOperationError();
    }
    const submittedRows = requestToVocabularyDraft(operation.request);
    setRows(submittedRows);
    await saveVocabularyDraft(submittedRows);
  };

  const submit = async () => {
    setValidationAttempted(true);
    setMessage(null);
    const validation = validateVocabularyDraft(rows);
    if (!validation.success) {
      setMessage(validation.formError ?? '请修正标出的单词后再提交');
      return;
    }

    setSubmitting(true);
    try {
      const operation = await prepareCreatePracticeOperation(
        { ...validation.request, format: 'topic_set' },
      );
      await registerAnonymous(true);
      const accepted = await createPractice(
        operation.request,
        operation.idempotencyKey,
      );
      await saveActivePracticeId(accepted.practiceId);
      router.replace({
        pathname: '/practice/[id]/generating',
        params: { id: accepted.practiceId },
      });
    } catch (error) {
      if (error instanceof PendingCreateOperationError) {
        try {
          await restorePendingOperation();
          setValidationAttempted(false);
        } catch {
          setMessage('暂时无法恢复上一次创建请求');
          return;
        }
      }
      setMessage(publicErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (ageConfirmed === null || !draftLoaded) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!ageConfirmed) {
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
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityLabel="返回"
            hitSlop={8}
            onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>创建主题短文练习</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.ageContent}>
          <View
            style={[
              styles.ageCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <View style={[styles.ageIcon, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="shield-checkmark" size={34} color={theme.accent} />
            </View>
            <Text style={[styles.ageTitle, { color: theme.text }]}>使用前请确认年龄</Text>
            <Text style={[styles.ageBody, { color: theme.textSecondary }]}>
              AI 主题短文练习仅面向年满 14 周岁的用户，内容会经过安全检查。
            </Text>
            <TouchableOpacity
              disabled={submitting}
              onPress={() => void confirmAge()}
              style={[styles.primaryButton, { backgroundColor: theme.accent }]}>
              <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>
                我已年满 14 周岁
              </Text>
            </TouchableOpacity>
            {message ? (
              <Text style={[styles.message, { color: theme.danger }]}>{message}</Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity
          accessibilityLabel="返回"
          hitSlop={8}
          onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>录入词义</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: theme.text }]}>你想复习哪些单词？</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          录入 1–10 个单词或短语及原文中的中文含义，生成 4 篇不同主题的短文，自选阅读顺序。
        </Text>

        <VocabularyInputList
          disabled={submitting}
          onChange={updateRows}
          validationAttempted={validationAttempted}
          value={rows}
        />

        {message ? (
          <Text style={[styles.message, { color: theme.danger }]}>{message}</Text>
        ) : null}

        <TouchableOpacity
          disabled={submitting}
          onPress={() => void submit()}
          style={[
            styles.primaryButton,
            {
              backgroundColor: theme.accent,
              opacity: submitting ? 0.65 : 1,
            },
          ]}>
          {submitting ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <>
              <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>
                生成 4 篇主题短文
              </Text>
              <Ionicons name="sparkles" size={18} color={theme.accentText} />
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: weight('semibold'),
    textAlign: 'center',
  },
  headerSpacer: { width: 26 },
  content: { paddingHorizontal: 16, paddingTop: 18 },
  title: { fontSize: 25, fontWeight: weight('bold') },
  subtitle: { fontSize: 14, lineHeight: 22, marginBottom: 20, marginTop: 8 },
  ageContent: { flex: 1, justifyContent: 'center', padding: 24 },
  ageCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
  },
  ageIcon: {
    alignItems: 'center',
    borderRadius: 32,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  ageTitle: { fontSize: 20, fontWeight: weight('bold'), marginTop: 18 },
  ageBody: {
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 50,
    paddingHorizontal: 18,
  },
  primaryButtonText: { fontSize: 16, fontWeight: weight('bold') },
  message: { fontSize: 13, lineHeight: 20, marginTop: 12, textAlign: 'center' },
});
