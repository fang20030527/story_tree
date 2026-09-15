import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { createPractice, registerAnonymous } from '@/api/practices';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { loadPracticeTargetCount } from '@/features/practice/practicePreferences';
import {
  clearCreatePracticeOperation, hasConfirmedAge, loadCreatePracticeOperation,
  prepareCreatePracticeOperation, saveActivePracticeId, saveAgeConfirmation,
} from '@/features/practice/practiceStorage';

export default function VocabularyPracticeSetupScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [needsAge, setNeedsAge] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);

  const start = useCallback(async (confirmAge = false) => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      if (confirmAge) await saveAgeConfirmation();
      const confirmed = confirmAge || await hasConfirmedAge();
      if (!mounted.current) return;
      if (!confirmed) { setNeedsAge(true); return; }
      setNeedsAge(false);
      const pending = await loadCreatePracticeOperation();
      if (pending && !('source' in pending.request)) {
        throw new Error('已有一次手动录入的创建请求待确认，请先继续上次操作');
      }
      // A retry must retain its original payload and key, even after settings change.
      const count = pending && 'source' in pending.request
        ? pending.request.targetCount : await loadPracticeTargetCount();
      if (!mounted.current) return;
      setTargetCount(count);
      const operation = pending ?? await prepareCreatePracticeOperation({
        source: 'vocabulary', format: 'topic_set', targetCount: count,
      });
      await registerAnonymous(true);
      const accepted = await createPractice(operation.request, operation.idempotencyKey);
      await saveActivePracticeId(accepted.practiceId);
      if (mounted.current) router.replace({
        pathname: '/practice/[id]/generating',
        params: { id: accepted.practiceId, origin: 'vocabulary' },
      });
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        await clearCreatePracticeOperation().catch(() => undefined);
      }
      if (mounted.current) setMessage(error instanceof Error ? error.message : '暂时无法创建练习，请稍后重试');
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => void start(), 0);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, [start]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="返回" hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>创建主题短文练习</Text>
        <View style={{ width: 26 }} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>
          {needsAge ? '使用前请确认年龄' : message ? '暂时无法生成练习' : '正在准备练习'}
        </Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {needsAge ? 'AI 主题短文练习仅面向年满 14 周岁的用户，内容会经过安全检查。'
            : targetCount === null ? '正在读取练习设置…' : `按设置最多选取 ${targetCount} 个待复习词，不足时按实际数量生成 4 篇主题短文。`}
        </Text>
        {submitting ? <ActivityIndicator accessibilityLabel="正在创建练习" color={theme.accent} /> : null}
        {message ? <Text style={[styles.body, { color: theme.danger }]}>{message}</Text> : null}
        {!submitting && (needsAge || message) ? (
          <TouchableOpacity style={[styles.button, { backgroundColor: theme.accent }]} onPress={() => void start(needsAge)}>
            <Text style={{ color: theme.accentText }}>{needsAge ? '我已年满 14 周岁' : '重试'}</Text>
          </TouchableOpacity>
        ) : null}
        {message && !submitting ? <>
          <TouchableOpacity style={styles.link} onPress={() => router.replace('/(tabs)/profile')}>
            <Text style={{ color: theme.blue }}>前往“我的”调整练习数量</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.link} onPress={() => router.replace('/(tabs)/words')}>
            <Text style={{ color: theme.blue }}>查看全部词库</Text>
          </TouchableOpacity>
        </> : null}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: weight('bold') },
  body: { fontSize: 14, lineHeight: 23, textAlign: 'center' },
  button: { minHeight: 48, borderRadius: 12, paddingHorizontal: 24, justifyContent: 'center' },
  link: { minHeight: 44, justifyContent: 'center' },
});
