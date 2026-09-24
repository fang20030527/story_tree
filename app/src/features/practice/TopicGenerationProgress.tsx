import type { PracticeDto } from '@context-reader/contracts';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

const labels: Record<PracticeDto['status'], string> = {
  queued: '等待生成', generating: '正在生成', validating: '正在检查',
  ready: '已生成', in_progress: '已生成', completed: '已生成', failed: '生成失败',
};
const readable = new Set<PracticeDto['status']>(['ready', 'in_progress', 'completed']);

export function TopicGenerationProgress({ group, unavailable }: {
  group: NonNullable<PracticeDto['group']>;
  unavailable: boolean;
}) {
  const { theme } = useAppTheme();
  const total = group.articles.length;
  const ready = group.articles.filter((article) => readable.has(article.status)).length;
  const failed = group.articles.filter((article) => article.status === 'failed').length;
  const settled = ready + failed;
  const pending = settled < total;
  const percent = Math.round(ready / total * 100);

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: theme.text }]}>
          {pending ? `已生成 ${ready}/${total}` : failed ? `生成结束 · ${ready}/${total} 篇可读` : '四篇短文已生成'}
        </Text>
        <Text style={[styles.percent, { color: theme.accent }]}>{percent}%</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel="短文生成进度"
        accessibilityValue={{ min: 0, max: total, now: ready, text: `${ready} 篇可阅读，${failed} 篇未成功，${total - settled} 篇处理中` }}
        style={styles.segments}>
        {group.articles.map((article) => (
          <View key={article.id} style={[styles.segment, { backgroundColor: readable.has(article.status)
            ? theme.accent : article.status === 'failed' ? theme.danger : theme.border }]} />
        ))}
      </View>
      <Text style={[styles.detail, { color: theme.textSecondary }]}>
        {ready} 篇可阅读{failed ? ` · ${failed} 篇未成功` : ''}
      </Text>
      <View style={styles.topics}>
        {group.articles.map((article) => {
          const active = article.status === 'generating' || article.status === 'validating';
          const color = article.status === 'failed' ? theme.danger
            : readable.has(article.status) || active ? theme.accent : theme.textMuted;
          return (
            <View key={article.id} style={styles.topic}>
              <Text style={[styles.topicName, { color: theme.text }]}>{article.topic}</Text>
              <View style={styles.status}>
                {active && !unavailable ? <ActivityIndicator size="small" color={color} /> : null}
                <Text style={[styles.detail, { color }]}>{labels[article.status]}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: theme.textMuted }]}>
        {unavailable ? '进度更新暂时中断，当前显示上次获取的状态。'
          : pending ? '可阅读比例按实际生成篇数更新；单篇进度按服务端完成步骤更新。'
            : failed ? '未成功的短文已标记，其他短文可以正常阅读。' : '全部准备好了，选择感兴趣的主题开始阅读。'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15, fontWeight: weight('semibold') },
  percent: { fontSize: 20, fontWeight: weight('bold') },
  segments: { flexDirection: 'row', gap: 5 },
  segment: { flex: 1, height: 8, borderRadius: 4 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  topic: { width: '50%', gap: 5 },
  topicName: { fontSize: 13, fontWeight: weight('semibold') },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detail: { fontSize: 12, lineHeight: 18 },
  hint: { fontSize: 12, lineHeight: 19 },
});
