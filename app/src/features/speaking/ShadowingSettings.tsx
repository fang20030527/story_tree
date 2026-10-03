import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SheetFrame, TextAction } from '@/components/subpage';
import { fonts, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

type Props = { visible: boolean; close: () => void; rate: number; changeRate: (rate: number) => void; repeatCount: number; setRepeatCount: (count: number) => void; gap: number; setGap: (gap: number) => void; fontSize: number; setFontSize: (size: number) => void; skipGaps: boolean; setSkipGaps: (skip: boolean) => void };
export function ShadowingSettings(props: Props) {
  const { theme } = useAppTheme();
  const chip = (selected: boolean) => [styles.chip, { backgroundColor: selected ? theme.text : theme.surfaceAlt }];
  const choices = (label: string, values: number[], value: number, select: (value: number) => void, suffix = '') => <View style={styles.group}>
    <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
    <View style={styles.chips}>{values.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`${label} ${item === 0 && label === '复读次数' ? '不限' : item}${suffix}`} accessibilityState={{ selected: item === value }} onPress={() => select(item)} style={({ pressed }) => [...chip(item === value), { opacity: pressed ? .7 : 1 }]}>
      <Text style={[styles.chipText, { color: item === value ? theme.bg : theme.textSecondary }]}>{item === 0 && label === '复读次数' ? '不限' : `${item}${suffix}`}</Text>
    </Pressable>)}</View>
  </View>;
  return <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.close}><Pressable onPress={props.close} accessibilityLabel="关闭练习设置" style={styles.backdrop}><Pressable onPress={event => event.stopPropagation()} style={{ width: '100%' }}><SheetFrame title="练习设置"><ScrollView>
    {choices('播放速度', [.5, .75, 1, 1.25, 1.5, 1.75, 2], props.rate, props.changeRate, '×')}
    <View style={styles.fine}>
      <Pressable accessibilityRole="button" accessibilityLabel="减慢 0.05 倍" onPress={() => props.changeRate(Math.max(.5, Math.round((props.rate - .05) * 100) / 100))} style={[styles.step, { backgroundColor: theme.surfaceAlt }]}><Text style={[styles.stepText, { color: theme.text }]}>−</Text></Pressable>
      <Text style={[styles.rate, { color: theme.text }]}>{props.rate.toFixed(2)}×</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="加快 0.05 倍" onPress={() => props.changeRate(Math.min(2, Math.round((props.rate + .05) * 100) / 100))} style={[styles.step, { backgroundColor: theme.surfaceAlt }]}><Text style={[styles.stepText, { color: theme.text }]}>＋</Text></Pressable>
    </View>
    {choices('复读次数', [1, 3, 5, 0], props.repeatCount, props.setRepeatCount)}{choices('复读停顿', [0, 1, 2], props.gap, props.setGap, '秒')}{choices('台词字号', [17, 21, 25], props.fontSize, props.setFontSize)}
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: props.skipGaps }} onPress={() => props.setSkipGaps(!props.skipGaps)} style={styles.switchRow}>
      <View style={{ flex: 1 }}><Text style={[styles.label, { color: theme.text, marginBottom: 2 }]}>跳过空白</Text><Text style={{ color: theme.textMuted, fontSize: 12 }}>句与句之间的静音直接跳过</Text></View>
      <View style={[styles.switchTrack, { backgroundColor: props.skipGaps ? theme.accent : theme.surfaceAlt }]}><View style={[styles.switchKnob, { backgroundColor: theme.surface, alignSelf: props.skipGaps ? 'flex-end' : 'flex-start' }]} /></View>
    </Pressable>
    <TextAction label="完成" onPress={props.close} />
  </ScrollView></SheetFrame></Pressable></Pressable></Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(21, 14, 16, 0.42)', justifyContent: 'flex-end' },
  group: { paddingTop: 12, marginTop: 4 },
  label: { fontSize: 15, fontWeight: weight('semibold'), marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: 'center' },
  chipText: { fontFamily: fonts.label, fontSize: 13 },
  fine: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  step: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 18, lineHeight: 22 },
  rate: { fontFamily: fonts.display, fontSize: 18, minWidth: 56, textAlign: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, marginTop: 6 },
  switchTrack: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  switchKnob: { width: 20, height: 20, borderRadius: 10 },
});
