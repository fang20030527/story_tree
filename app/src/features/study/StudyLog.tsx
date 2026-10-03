import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { useHydrationReady } from '@/components/useLayoutWidth';
import { useModeAccent } from '@/context/modeAccent';
import { DAILY_GOAL_MS, localDateKey, type StudyTotals } from './studyStorage';

export function studyWeeks(now: Date): Date[][] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 84);
  return Array.from({ length: 13 }, (_, week) => Array.from({ length: 7 }, (_, day) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day)));
}

export function StudyLog({ totals, now, error }: { totals: StudyTotals; now: Date; error: boolean }) {
  const { theme } = useAppTheme();
  const accent = useModeAccent();
  const ready = useHydrationReady();
  const today = localDateKey(now);
  const [selection, setSelection] = useState<{ date: string; today: string } | null>(null);
  if (!ready) return <View style={styles.log}><Text style={[styles.title, { color: theme.text }]}>学习日志</Text><Text style={[styles.detail, { color: theme.textMuted }]}>正在读取学习记录…</Text></View>;
  const selected = selection?.today === today ? selection.date : today;
  const palette = theme.heat;
  const level = (ms: number) => ms === 0 ? 0 : ms < 5 * 60_000 ? 1 : ms < DAILY_GOAL_MS ? 2 : ms < 20 * 60_000 ? 3 : 4;
  const weeks = studyWeeks(now);
  const activeDays = weeks.flat().filter(date => localDateKey(date) <= today && (totals[localDateKey(date)] ?? 0) > 0).length;
  return <View style={styles.log}>
    <View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>学习日志</Text><Text style={{ fontSize: 12, color: theme.textMuted }}>近 13 周 · {activeDays} 天有学习</Text></View>
    <View style={styles.chart}>
      <View style={styles.weekdays}>{['日', '一', '二', '三', '四', '五', '六'].map(day => <Text key={day} style={[styles.dayLabel, { color: theme.textMuted }]}>{day}</Text>)}</View>
      <View style={styles.weeks}>{weeks.map((week, index) => <View key={index} style={styles.week}>
        <Text style={[styles.month, { color: theme.textMuted }]}>{index === 0 || week[0].getMonth() !== weeks[index - 1][0].getMonth() ? `${week[0].getMonth() + 1}月` : ''}</Text>
        {week.map(date => {
          const key = localDateKey(date), future = key > today, ms = future ? 0 : totals[key] ?? 0;
          return <Pressable key={key} disabled={future || error} accessibilityRole="button"
            accessibilityLabel={`${key}${key === today ? ' 今日' : ''}${ms >= DAILY_GOAL_MS ? ' 已打卡' : ''}，学习 ${Math.floor(ms / 60_000)} 分钟`}
            accessibilityState={{ selected: selected === key, disabled: future || error }}
            onPress={() => setSelection({ date: key, today })} style={[styles.cell, { backgroundColor: future ? 'transparent' : palette[error ? 0 : level(ms)], borderColor: selected === key ? accent.ink : 'transparent' }]} />;
        })}
      </View>)}</View>
    </View>
    <View style={styles.legend}><Text style={[styles.note, { color: theme.textMuted }]}>每天 10 分钟，慢慢积累。</Text><Text style={{ color: theme.textMuted, fontSize: 10 }}>少</Text>{palette.map(color => <View key={color} style={[styles.legendCell, { backgroundColor: color }]} />)}<Text style={{ color: theme.textMuted, fontSize: 10 }}>多</Text></View>
    <Text accessibilityLiveRegion="polite" style={[styles.detail, { color: theme.textSecondary }]}>{error ? '学习时长读取失败，请重新打开本页重试' : `${selected} · 学习 ${Math.floor((totals[selected] ?? 0) / 60_000)} 分钟${(totals[selected] ?? 0) >= DAILY_GOAL_MS ? ' · 已完成每日目标' : ''}`}</Text>
  </View>;
}

const styles = StyleSheet.create({
  log: { paddingTop: 26, paddingBottom: 14 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 18 },
  title: { fontSize: 19, lineHeight: 26, fontWeight: '600' },
  chart: { flexDirection: 'row', gap: 7 },
  weekdays: { width: 14, paddingTop: 21, justifyContent: 'space-around' },
  dayLabel: { fontSize: 9, textAlign: 'center' },
  weeks: { flex: 1, flexDirection: 'row', gap: 4 },
  week: { flex: 1, gap: 4 },
  month: { height: 18, fontSize: 9, overflow: 'visible', width: 28 },
  cell: { aspectRatio: 1, borderRadius: 4, borderWidth: 2 },
  legend: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 3, marginTop: 14, flexWrap: 'wrap' },
  legendCell: { width: 10, height: 10, borderRadius: 3 },
  note: { flex: 1, minWidth: 145, fontSize: 11.5 },
  detail: { fontSize: 12, lineHeight: 20, marginTop: 12 },
});
