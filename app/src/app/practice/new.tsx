import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { createPractice, registerAnonymous } from '@/api/practices';
import { Meta, PrimaryAction, SectionHeading, SubpageHeader, subpageStyles } from '@/components/subpage';
import { useAppTheme } from '@/context/ThemeContext';
import { VocabularyInputList } from '@/features/practice/VocabularyInputList';
import {
  MAX_DRAFT_WORDS,
  type VocabularyDraftRow,
  resolveDraftMeanings,
  validateVocabularyDraft,
} from '@/features/practice/practiceDraft';
import {
  EMPTY_VOCABULARY_DRAFT,
  PendingCreateOperationError,
  loadCreatePracticeOperation,
  loadVocabularyDraft,
  prepareCreatePracticeOperation,
  requestToVocabularyDraft,
  saveActivePracticeId,
  saveVocabularyDraft,
} from '@/features/practice/practiceStorage';

/** 输入停顿多久后先补上能查到的释义；查不到的等失焦或提交时再标出。 */
const LOOKUP_PAUSE_MS = 450;

function publicErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof PendingCreateOperationError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '暂时无法创建练习，请稍后重试';
}

export default function NewPracticeScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<VocabularyDraftRow[]>(
    () => EMPTY_VOCABULARY_DRAFT.map((row) => ({ ...row })),
  );
  const rowsRef = useRef(rows);
  const draftLoadedRef = useRef(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const filledCount = rows.filter((row) => row.term.trim()).length;

  const commitRows = useCallback((nextRows: VocabularyDraftRow[]) => {
    rowsRef.current = nextRows;
    setRows(nextRows);
    setMessage(null);
    if (!draftLoadedRef.current) return;
    void saveVocabularyDraft(nextRows).catch(() => {
      setMessage('草稿保存失败，请检查设备存储后重试');
    });
  }, []);

  /** 查本地词典补释义；markMissing 时把查不到的标成未收录。 */
  const resolveMeanings = useCallback((markMissing: boolean) => {
    const resolved = resolveDraftMeanings(rowsRef.current, markMissing);
    if (resolved !== rowsRef.current) commitRows(resolved);
    return resolved;
  }, [commitRows]);

  useEffect(() => {
    let mounted = true;
    loadVocabularyDraft()
      .then((storedRows) => {
        if (!mounted) return;
        draftLoadedRef.current = true;
        rowsRef.current = storedRows;
        setRows(storedRows);
        setDraftLoaded(true);
        resolveMeanings(true);
      })
      .catch(() => {
        if (!mounted) return;
        draftLoadedRef.current = true;
        setDraftLoaded(true);
        setMessage('暂时无法读取本地草稿');
      });
    return () => {
      mounted = false;
      if (lookupTimer.current) clearTimeout(lookupTimer.current);
    };
  }, [resolveMeanings]);

  const updateRows = (nextRows: VocabularyDraftRow[]) => {
    commitRows(nextRows);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(() => {
      lookupTimer.current = null;
      resolveMeanings(false);
    }, LOOKUP_PAUSE_MS);
  };

  const restorePendingOperation = async () => {
    const operation = await loadCreatePracticeOperation();
    if (!operation) return;
    if (!('items' in operation.request)) {
      throw new PendingCreateOperationError();
    }
    const submittedRows = requestToVocabularyDraft(operation.request);
    rowsRef.current = submittedRows;
    setRows(submittedRows);
    await saveVocabularyDraft(submittedRows);
  };

  const submit = async () => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const resolved = resolveMeanings(true);
    setValidationAttempted(true);
    setMessage(null);
    const validation = validateVocabularyDraft(resolved);
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

  if (!draftLoaded) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SubpageHeader title="创建主题短文" />
      <ScrollView
        contentContainerStyle={[
          subpageStyles.content,
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={[subpageStyles.title, { color: theme.text }]}>你想复习哪些单词？</Text>
        <Text style={[subpageStyles.lede, styles.lede, { color: theme.textSecondary }]}>
          输入 1–10 个单词或短语，释义会自动从离线词典查好，然后生成 4 篇不同主题的短文。
        </Text>

        <SectionHeading
          title="单词"
          action={<Meta tone={filledCount ? 'ink' : 'muted'}>{filledCount}/{MAX_DRAFT_WORDS}</Meta>}
        />
        <VocabularyInputList
          disabled={submitting}
          onChange={updateRows}
          onSettle={() => resolveMeanings(true)}
          validationAttempted={validationAttempted}
          value={rows}
        />

        {message ? (
          <Text accessibilityLiveRegion="polite" style={[styles.message, { color: theme.danger }]}>{message}</Text>
        ) : null}

        <PrimaryAction
          arrow
          busy={submitting}
          disabled={!filledCount}
          label={submitting ? '正在创建…' : '生成 4 篇主题短文'}
          onPress={() => void submit()}
          style={styles.primary}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  content: { paddingTop: 12 },
  lede: { marginTop: 8 },
  message: { fontSize: 13, lineHeight: 20, marginTop: 16 },
  primary: { marginTop: 28 },
});
