import { usePracticeExitGuard } from '@/features/practice/usePracticeExitGuard';
import { Ionicons } from '@expo/vector-icons';
import type { PracticeDto, PracticeTopic } from '@context-reader/contracts';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { clearActivePracticeId, saveActivePracticeId } from '@/features/practice/practiceStorage';
import { usePracticePolling } from '@/features/practice/usePracticePolling';

const topicIcons: Record<PracticeTopic, keyof typeof Ionicons.glyphMap> = {
  经济: 'trending-up-outline', 文化: 'color-palette-outline', 政治: 'business-outline',
  科技: 'hardware-chip-outline', 教育: 'school-outline', 环境: 'leaf-outline', 社会: 'people-outline',
};
const statusLabels: Record<PracticeDto['status'], string> = {
  queued: '等待生成', generating: '正在生成', validating: '正在检查',
  ready: '开始阅读', in_progress: '继续练习', completed: '已完成 · 再读一遍', failed: '生成未完成',
};
const readable = new Set(['ready', 'in_progress', 'completed']);

function TopicSelection({ practiceId }: { practiceId: string }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { practice, error, retry } = usePracticePolling(practiceId);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  useFocusEffect(useCallback(() => { retry(); }, [retry]));
  const group = practice?.group;
  usePracticeExitGuard(practiceId, !group || group.articles.some((article) => article.status !== 'completed' && article.status !== 'failed'));
  const completed = group?.articles.filter((article) => article.status === 'completed').length ?? 0;
  const readyCount = group?.articles.filter((article) => readable.has(article.status)).length ?? 0;
  const failedCount = group?.articles.filter((article) => article.status === 'failed').length ?? 0;
  const total = group?.articles.length ?? 4;
  const settled = readyCount + failedCount;
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
      router.replace('/');
    } catch {
      setStorageError('暂时无法保存完成状态，请重试');
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
        <Text style={[styles.eyebrow, { color: theme.accent }]}>FOUR PERSPECTIVES</Text>
        <Text style={[styles.title, { color: theme.text }]}>今天，先读哪个主题？</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          4 个主题，4 篇短文。按兴趣选择，随时回来继续。
        </Text>
        {group ? (
          <View style={styles.progressSection}>
            <View style={styles.progressHeading}>
              <Text style={[styles.actionText, { color: theme.text }]}>
                {pending ? `生成进度 ${settled}/${total}` : '生成已结束'}
              </Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {readyCount} 篇可阅读{failedCount ? ` · ${failedCount} 篇未成功` : ''}
              </Text>
            </View>
            <View accessibilityRole="progressbar" accessibilityLabel="短文生成进度"
              accessibilityValue={{ min: 0, max: total, now: settled, text: `${readyCount} 篇可阅读，${failedCount} 篇未成功，${total - settled} 篇处理中` }}
              style={[styles.progressTrack, { backgroundColor: theme.border }]}>
              <View style={{ width: `${readyCount / total * 100}%`, backgroundColor: theme.accent }} />
              <View style={{ width: `${failedCount / total * 100}%`, backgroundColor: theme.danger }} />
            </View>
          </View>
        ) : null}
        {pending ? (
          <View style={[styles.notice, { backgroundColor: theme.accentSoft }]}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={[styles.noticeText, { color: theme.textSecondary }]}>短文陆续生成中，已就绪的主题可以先读。</Text>
          </View>
        ) : null}
        {!practice && !error ? <ActivityIndicator accessibilityLabel="正在加载主题" color={theme.accent} /> : null}
        {group?.articles.map((article, index) => {
          const available = readable.has(article.status);
          const failed = article.status === 'failed';
          return (
            <TouchableOpacity
              key={article.id}
              accessibilityRole="button"
              accessibilityLabel={`${article.topic}，${statusLabels[article.status]}`}
              disabled={!available || opening}
              onPress={() => void openArticle(article.id)}
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.cardHeading}>
                <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
                  <Ionicons name={topicIcons[article.topic]} size={23} color={theme.accent} />
                </View>
                <Text style={[styles.topic, { color: theme.text }]}>{article.topic}</Text>
                <Text style={[styles.number, { color: theme.textMuted }]}>0{index + 1}</Text>
              </View>
              <Text style={[styles.articleTitle, { color: theme.text }]}>
                {article.title ?? (failed ? '这篇短文暂未生成' : '正在准备新的阅读视角…')}
              </Text>
              {failed ? <Text style={[styles.failure, { color: theme.danger }]}>{article.failureMessage ?? '请稍后重新创建一组短文'}</Text> : null}
              <View style={styles.cardFooter}>
                <Text style={[styles.meta, { color: theme.textMuted }]}>
                  {article.wordCount ? `${article.wordCount} 词 · 约 ${Math.max(1, Math.ceil(article.wordCount / 120))} 分钟` : '200–300 词'}
                </Text>
                <View style={styles.action}>
                  <Text style={[styles.actionText, { color: article.status === 'completed' ? theme.green : theme.accent }]}>{statusLabels[article.status]}</Text>
                  <Ionicons name={article.status === 'completed' ? 'checkmark-circle' : available ? 'arrow-forward' : failed ? 'alert-circle-outline' : 'time-outline'} size={17} color={theme.accent} />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
        {practice && !group ? <Text style={{ color: theme.textSecondary }}>这是之前创建的单篇练习。</Text> : null}
        {practice && !group ? <TouchableOpacity onPress={() => router.replace({ pathname: '/practice/[id]/generating', params: { id: practice.id } })}><Text style={[styles.link, { color: theme.accent }]}>打开练习</Text></TouchableOpacity> : null}
        {error || storageError ? <View style={styles.error}>
          <Text style={{ color: theme.danger }}>{storageError ?? error?.message}</Text>
          {error ? <TouchableOpacity onPress={retry}><Text style={[styles.link, { color: theme.accent }]}>重新加载</Text></TouchableOpacity> : null}
        </View> : null}
      </ScrollView>
    </View>
  );
}

export default function TopicSelectionScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  if (typeof id !== 'string') return <View style={styles.content}><Text>练习地址无效</Text></View>;
  return <TopicSelection key={id} practiceId={id} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, minHeight: 52 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: weight('semibold') },
  counter: { width: 28, fontSize: 13 },
  content: { padding: 20, gap: 14, width: '100%', maxWidth: 760, alignSelf: 'center' },
  eyebrow: { marginTop: 12, fontSize: 11, letterSpacing: 2, fontWeight: weight('bold') },
  title: { fontSize: 27, lineHeight: 36, fontWeight: weight('bold') },
  subtitle: { fontSize: 14, lineHeight: 23, marginBottom: 8 },
  progressSection: { gap: 9 },
  progressHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 20 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 19, gap: 16 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { padding: 9, borderRadius: 12 },
  topic: { flex: 1, fontSize: 15, fontWeight: weight('semibold') },
  number: { fontSize: 12, letterSpacing: 1 },
  articleTitle: { fontSize: 21, lineHeight: 29, fontWeight: weight('semibold') },
  cardFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  meta: { fontSize: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { fontSize: 12, fontWeight: weight('semibold') },
  failure: { fontSize: 13, lineHeight: 20 },
  error: { gap: 8, paddingVertical: 12 },
  link: { paddingVertical: 12, fontSize: 14, fontWeight: weight('semibold') },
});
