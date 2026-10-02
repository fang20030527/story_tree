import type { PracticeDto } from '@context-reader/contracts';
import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';

import { useReducedMotion } from '@/components/motion';
import { fonts, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

const readable = new Set<PracticeDto['status']>(['ready', 'in_progress', 'completed']);

/** 生成中的分段缓慢明暗呼吸；减少动态效果时保持静止。 */
function PendingSegment({ color, animate }: { color: string; animate: boolean }) {
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced || !animate) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, animate, pulse]);
  return <Animated.View style={[styles.segment, { backgroundColor: color, opacity: pulse }]} />;
}

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
    <View style={styles.panel}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: theme.text }]}>
          {pending ? `已生成 ${ready}/${total}` : failed ? `生成结束 · ${ready}/${total} 篇可读` : '四篇短文已生成'}
        </Text>
        <Text style={[styles.percent, { color: theme.text }]}>{percent}%</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel="短文生成进度"
        accessibilityValue={{ min: 0, max: total, now: ready, text: `${ready} 篇可阅读，${failed} 篇未成功，${total - settled} 篇处理中` }}
        style={styles.segments}>
        {group.articles.map((article) => readable.has(article.status) || article.status === 'failed'
          ? <View key={article.id} style={[styles.segment, { backgroundColor: article.status === 'failed' ? theme.danger : theme.text }]} />
          : <PendingSegment key={article.id} color={theme.border} animate={!unavailable && (article.status === 'generating' || article.status === 'validating')} />)}
      </View>
      <Text style={[styles.detail, { color: theme.textSecondary }]}>
        {ready} 篇可阅读{failed ? ` · ${failed} 篇未成功` : ''}
      </Text>
      <Text style={[styles.hint, { color: theme.textMuted }]}>
        {unavailable ? '进度更新暂时中断，当前显示上次获取的状态。'
          : pending ? '已就绪的主题可以先读，其余短文生成后会出现在下方。'
            : failed ? '未成功的短文已标记，其他短文可以正常阅读。' : '全部准备好了，选择感兴趣的主题开始阅读。'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10, paddingVertical: 8 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15, fontWeight: weight('semibold') },
  percent: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  segments: { flexDirection: 'row', gap: 3 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  detail: { fontSize: 12, lineHeight: 18 },
  hint: { fontSize: 12, lineHeight: 19 },
});
