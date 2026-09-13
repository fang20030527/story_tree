import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { createPractice, registerAnonymous } from '@/api/practices';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  PendingCreateOperationError,
  clearCreatePracticeOperation,
  hasConfirmedAge,
  loadCreatePracticeOperation,
  prepareCreatePracticeOperation,
  saveActivePracticeId,
  saveAgeConfirmation,
} from '@/features/practice/practiceStorage';

const DEFAULT_TARGET_COUNT = 10;

function publicErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof PendingCreateOperationError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '暂时无法创建练习，请稍后重试';
}

function parseTargetCount(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export default function VocabularyPracticeSetupScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [targetCountText, setTargetCountText] = useState(
    String(DEFAULT_TARGET_COUNT),
  );
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([hasConfirmedAge(), loadCreatePracticeOperation()])
      .then(([confirmed, operation]) => {
        if (!mounted) return;
        setAgeConfirmed(confirmed);
        if (operation && 'source' in operation.request) {
          setTargetCountText(String(operation.request.targetCount));
        } else if (operation) {
          setMessage('已有一次手动录入的创建请求待确认，请先继续上次操作');
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!mounted) return;
        setMessage('暂时无法读取本地创建状态');
        setLoaded(true);
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

  const adjustTargetCount = (delta: number) => {
    const current = parseTargetCount(targetCountText) ?? DEFAULT_TARGET_COUNT;
    const next = current + delta;
    if (!Number.isSafeInteger(next) || next < 1) return;
    setTargetCountText(String(next));
    setMessage(null);
  };

  const submit = async () => {
    const targetCount = parseTargetCount(targetCountText);
    setMessage(null);
    if (targetCount === null) {
      setMessage('请输入大于 0 的整数');
      return;
    }

    setSubmitting(true);
    try {
      const operation = await prepareCreatePracticeOperation({
        source: 'vocabulary',
        targetCount,
      });
      await registerAnonymous(true);
      const accepted = await createPractice(
        operation.request,
        operation.idempotencyKey,
      );
      await saveActivePracticeId(accepted.practiceId);
      router.replace({
        pathname: '/practice/[id]/generating',
        params: { id: accepted.practiceId, origin: 'vocabulary' },
      });
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        await clearCreatePracticeOperation().catch(() => undefined);
      }
      setMessage(publicErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!loaded) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
        <Text style={[styles.headerTitle, { color: theme.text }]}>创建长文练习</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!ageConfirmed ? (
        <View style={styles.centeredContent}>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="shield-checkmark" size={34} color={theme.accent} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>使用前请确认年龄</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              AI 长文练习仅面向年满 14 周岁的用户，内容会经过安全检查。
            </Text>
            <TouchableOpacity
              onPress={() => void confirmAge()}
              style={[styles.primaryButton, { backgroundColor: theme.accent }]}>
              <Text style={[styles.primaryText, { color: theme.accentText }]}>
                我已年满 14 周岁
              </Text>
            </TouchableOpacity>
            {message ? (
              <Text style={[styles.message, { color: theme.danger }]}>{message}</Text>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.content}>
          <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="sparkles" size={34} color={theme.accent} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>设置本次练习</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            你只需设置数量，具体词条将由系统从待复习词库中随机抽取。
          </Text>

          <View
            style={[
              styles.countCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <Text style={[styles.countLabel, { color: theme.textSecondary }]}>
              目标词数
            </Text>
            <View style={styles.counterRow}>
              <TouchableOpacity
                accessibilityLabel="减少目标词数"
                disabled={submitting || parseTargetCount(targetCountText) === 1}
                onPress={() => adjustTargetCount(-1)}
                style={[
                  styles.counterButton,
                  {
                    backgroundColor: theme.surfaceAlt,
                    opacity: parseTargetCount(targetCountText) === 1 ? 0.45 : 1,
                  },
                ]}>
                <Ionicons name="remove" size={24} color={theme.text} />
              </TouchableOpacity>
              <TextInput
                accessibilityLabel="练习目标词数"
                editable={!submitting}
                inputMode="numeric"
                keyboardType="number-pad"
                onChangeText={(value) => {
                  setTargetCountText(value);
                  setMessage(null);
                }}
                selectTextOnFocus
                style={[
                  styles.countInput,
                  {
                    backgroundColor: theme.bg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={targetCountText}
              />
              <TouchableOpacity
                accessibilityLabel="增加目标词数"
                disabled={submitting}
                onPress={() => adjustTargetCount(1)}
                style={[
                  styles.counterButton,
                  { backgroundColor: theme.surfaceAlt },
                ]}>
                <Ionicons name="add" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.hint, { color: theme.textMuted }]}>
              默认 10 个，可根据自己的水平自由调整
            </Text>
          </View>

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
                <Text style={[styles.primaryText, { color: theme.accentText }]}>
                  随机抽词并生成
                </Text>
                <Ionicons name="sparkles" size={18} color={theme.accentText} />
              </>
            )}
          </TouchableOpacity>
          <Text style={[styles.footerHint, { color: theme.textMuted }]}>
            已掌握和用户自报已会的义项不会被抽取
          </Text>
        </View>
      )}
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
  centeredContent: { flex: 1, justifyContent: 'center', padding: 24 },
  content: { alignItems: 'center', flex: 1, paddingHorizontal: 24, paddingTop: 42 },
  card: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 32,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  title: { fontSize: 22, fontWeight: weight('bold'), marginTop: 18 },
  body: {
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 360,
    textAlign: 'center',
  },
  countCard: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 28,
    padding: 20,
  },
  countLabel: { fontSize: 14, fontWeight: weight('medium') },
  counterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
  },
  counterButton: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  countInput: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 26,
    fontWeight: weight('bold'),
    height: 52,
    minWidth: 90,
    paddingHorizontal: 12,
    textAlign: 'center',
  },
  hint: { fontSize: 12, marginTop: 12, textAlign: 'center' },
  primaryButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 50,
    paddingHorizontal: 18,
  },
  primaryText: { fontSize: 16, fontWeight: weight('bold') },
  message: { fontSize: 13, lineHeight: 20, marginTop: 14, textAlign: 'center' },
  footerHint: { fontSize: 12, marginTop: 14, textAlign: 'center' },
});
