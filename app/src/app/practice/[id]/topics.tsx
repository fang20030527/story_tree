import { usePracticeExitGuard } from '@/features/practice/usePracticeExitGuard';
import { Ionicons } from '@expo/vector-icons';
import type { PracticeDto } from '@context-reader/contracts';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressFeedback } from '@/components/motion';
import { SecondaryAction } from '@/components/subpage';
import { fonts, weight } from '@/constants/theme';
import { createIdempotencyKey } from '@/api/installation';
import { retryFailedTopics } from '@/api/practices';
import { useAppTheme } from '@/context/ThemeContext';
import { clearActivePracticeId, saveActivePracticeId } from '@/features/practice/practiceStorage';
import { TopicGenerationProgress } from '@/features/practice/TopicGenerationProgress';
import { usePracticePolling } from '@/features/practice/usePracticePolling';

const statusLabels: Record<PracticeDto['status'], string> = {
  queued: '等待生成', generating: '正在生成', validating: '正在检查',
  ready: '开始阅读', in_progress: '继续练习', completed: '已完成 · 再读一遍', failed: '生成未完成',
};
const readable = new Set(['ready', 'in_progress', 'completed']);

function TopicSelection({ practiceId, vocabularyOrigin }: { practiceId: string; vocabularyOrigin: boolean }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { practice, error, retry } = usePracticePolling(practiceId);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryKey = useRef<Promise<string> | null>(null);
  useFocusEffect(useCallback(() => { retry(); }, [retry]));
  const group = practice?.group;
  usePracticeExitGuard(practiceId, !group || group.articles.some((article) => article.status !== 'completed' && article.status !== 'failed'), true);
  const completed = group?.articles.filter((article) => article.status === 'completed').length ?? 0;
  const pending = group?.articles.some((article) => !readable.has(article.status) && article.status !== 'failed');

  const openArticle = async (id: string) => {
    if (opening || !group) return;
    setOpening(true);
    setStorageError(null);
    try {
      await saveActivePracticeId(group.id);
      router.push({ pathname: '/practice/[id]/read', params: { id } });
    } catch {
      setStorageError('暂时无法保存阅读状态，请重试');
    } finally {
      setOpening(false);
    }
  };
  const goHome = async () => {
    try {
      if (group?.articles.every((article) => article.status === 'completed' || article.status === 'failed')) {
        await clearActivePracticeId();
      }
      router.replace(vocabularyOrigin ? '/practice/from-vocabulary' : '/');
    } catch {
      setStorageError('暂时无法保存完成状态，请重试');
    }
  };
  const retryFailed = async () => {
    if (!group || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      retryKey.current ??= createIdempotencyKey().catch((keyError: unknown) => {
        retryKey.current = null;
        throw keyError;
      });
      await retryFailedTopics(group.id, await retryKey.current);
      retryKey.current = null;
      retry();
    } catch (nextError) {
      setRetryError(nextError instanceof Error ? nextError.message : '暂时无法重试短文生成');
      retry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="返回首页" onPress={() => void goHome()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>主题短文</Text>
        <Text style={[styles.counter, { color: theme.textMuted }]}>{completed}/4</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>FOUR PERSPECTIVES</Text>
        <Text style={[styles.title, { color: theme.text }]}>今天，先读哪个主题？</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          4 个主题，4 篇短文。按兴趣选择，随时回来继续。
        </Text>
        {group ? <TopicGenerationProgress group={group} unavailable={Boolean(error)} /> : null}
        {group?.canRetryFailed ? (
          <SecondaryAction label={retrying ? '正在重新排队…' : '重试未生成的短文'} accessibilityLabel="重试未生成的短文"
            disabled={retrying} onPress={() => void retryFailed()} style={styles.retryFailedButton} />
        ) : null}
        {pending ? (
          <View style={styles.notice}>
            <ActivityIndicator size="small" color={theme.textMuted} />
            <Text style={[styles.noticeText, { color: theme.textSecondary }]}>短文陆续生成中，已就绪的主题可以先读。</Text>
          </View>
        ) : null}
        <View style={[styles.listTop, { backgroundColor: theme.text }]} />
        {!practice && !error ? <ActivityIndicator accessibilityLabel="正在加载主题" color={theme.accent} /> : null}
        {group?.articles.map((article, index) => {
          const available = readable.has(article.status);
          const failed = article.status === 'failed';
          const statusColor = article.status === 'completed' ? theme.success : available ? theme.accent : failed ? theme.danger : theme.textMuted;
          return (
            <PressFeedback
              key={article.id}
              accessibilityRole="button"
              accessibilityLabel={`${article.topic}，${statusLabels[article.status]}`}
              disabled={!available || opening}
              onPress={() => void openArticle(article.id)}
              style={[styles.card, { borderBottomColor: theme.border }]}>
              <View style={styles.cardHeading}>
                <Text style={[styles.number, { color: available ? theme.text : theme.textMuted }]}>0{index + 1}</Text>
                <Text style={[styles.topic, { color: theme.text }]}>{article.topic}</Text>
                <Text style={[styles.actionText, { color: statusColor }]}>{statusLabels[article.status]}{available && article.status !== 'completed' ? ' →' : ''}</Text>
              </View>
              <Text style={[styles.articleTitle, { color: available ? theme.text : theme.textMuted }]}>
                {article.title ?? (failed ? '这篇短文暂未生成' : '正在准备新的阅读视角…')}
              </Text>
              {failed && article.generationProgress === 0 ? (
                <Text style={[styles.articleProgressLabel, { color: theme.textMuted }]}>
                  本次生成进度未记录
                </Text>
              ) : available ? null : (
                <View style={styles.articleProgressRow}>
                  <View accessibilityRole="progressbar" accessibilityLabel={`${article.topic}短文生成进度`}
                    accessibilityValue={{ min: 0, max: 100, now: article.generationProgress }}
                    style={[styles.articleProgressTrack, { backgroundColor: theme.border }]}>
                    <View style={[styles.articleProgressFill, {
                      width: `${article.generationProgress}%`,
                      backgroundColor: failed ? theme.danger : theme.text,
                    }]} />
                  </View>
                  <Text style={[styles.articleProgressPercent, { color: failed ? theme.danger : theme.textSecondary }]}>
                    {failed ? '生成中断 ' : ''}{article.generationProgress}%
                  </Text>
                </View>
              )}
              {failed ? <Text style={[styles.failure, { color: theme.danger }]}>{article.failureMessage ?? '请稍后重新创建一组短文'}</Text> : null}
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                {article.wordCount ? `${article.wordCount} 词 · 约 ${Math.max(1, Math.ceil(article.wordCount / 120))} 分钟` : '200–300 词'}
              </Text>
            </PressFeedback>
          );
        })}
        {practice && !group ? <Text style={{ color: theme.textSecondary }}>这是之前创建的单篇练习。</Text> : null}
        {practice && !group ? <TouchableOpacity onPress={() => router.replace({ pathname: '/practice/[id]/generating', params: { id: practice.id } })}><Text style={[styles.link, { color: theme.accent }]}>打开练习</Text></TouchableOpacity> : null}
        {error || storageError || retryError ? <View style={styles.error}>
          <Text style={{ color: theme.danger }}>{storageError ?? retryError ?? error?.message}</Text>
          {error ? <TouchableOpacity onPress={retry}><Text style={[styles.link, { color: theme.accent }]}>重新加载</Text></TouchableOpacity> : null}
        </View> : null}
      </ScrollView>
    </View>
  );
}

export default function TopicSelectionScreen() {
  const { id, origin } = useLocalSearchParams<{ id?: string | string[]; origin?: string | string[] }>();
  if (typeof id !== 'string') return <View style={styles.content}><Text>练习地址无效</Text></View>;
  return <TopicSelection key={id} practiceId={id} vocabularyOrigin={origin === 'vocabulary'} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, minHeight: 52 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: weight('semibold') },
  counter: { width: 28, fontSize: 13 },
  content: { padding: 20, gap: 14, width: '100%', maxWidth: 760, alignSelf: 'center' },
  eyebrow: { marginTop: 12, fontFamily: fonts.label, fontSize: 11, letterSpacing: 1.6 },
  title: { fontSize: 27, lineHeight: 36, fontWeight: weight('bold') },
  subtitle: { fontSize: 14, lineHeight: 23, marginBottom: 4 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 20 },
  retryFailedButton: { alignSelf: 'flex-start' },
  listTop: { height: 1.5, marginTop: 8, marginBottom: -14 },
  card: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 18, gap: 8 },
  cardHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  topic: { flex: 1, fontSize: 15, fontWeight: weight('semibold') },
  number: { fontFamily: fonts.display, fontSize: 15 },
  articleTitle: { fontFamily: fonts.readingMedium, fontSize: 21, lineHeight: 28 },
  articleProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  articleProgressLabel: { fontSize: 12 },
  articleProgressPercent: { fontFamily: fonts.label, fontSize: 12 },
  articleProgressTrack: { flex: 1, height: 2, borderRadius: 1, overflow: 'hidden' },
  articleProgressFill: { height: '100%' },
  meta: { fontSize: 12 },
  actionText: { fontSize: 13, fontWeight: weight('semibold') },
  failure: { fontSize: 13, lineHeight: 20 },
  error: { gap: 8, paddingVertical: 12 },
  link: { paddingVertical: 12, fontSize: 14, fontWeight: weight('semibold') },
});
