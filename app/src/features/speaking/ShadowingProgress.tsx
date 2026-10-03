import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { formatSpeakingTime } from './model';
import { webKeyboard } from '@/components/webKeyboard';

/** 进度条上下各多留 10pt 触控余量；左右 8pt 覆盖两端，便于从 0 或片尾起拖。 */
const sliderHitSlop = { top: 10, bottom: 10, left: 8, right: 8 };

export function ShadowingProgress({ time, duration, enabled, seek, onDragChange }: {
  time: number; duration: number; enabled: boolean; seek: (time: number) => void;
  /** 拖动开始 / 结束（含被系统取消）时通知页面，用于暂停外层滚动与返回手势。 */
  onDragChange?: (dragging: boolean) => void;
}) {
  const { theme } = useAppTheme();
  const width = useRef(0);
  const drag = useRef<{ x: number; offset: number; time: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const displayed = preview ?? time;
  // 尚未完成布局（宽度为 0）时无法换算位置，直接忽略手势，避免产生 NaN 定位。
  const timeAt = (offset: number) => width.current > 0 && Number.isFinite(offset) && duration > 0 ? Math.max(0, Math.min(1, offset / width.current)) * duration : null;
  const change = (next: number) => { if (enabled && Number.isFinite(next)) seek(Math.max(0, Math.min(duration, next))); };
  const ratio = duration ? Math.min(1, displayed / duration) : 0;
  return <View style={styles.row}><Text style={[styles.time, { color: theme.textMuted }]}>{formatSpeakingTime(displayed)}</Text>
    <View accessible tabIndex={enabled ? 0 : -1} accessibilityRole="adjustable" accessibilityLabel="原音播放进度" accessibilityState={{ disabled: !enabled }}
      aria-valuemin={0} aria-valuemax={duration} aria-valuenow={displayed} aria-valuetext={`${formatSpeakingTime(displayed)} / ${formatSpeakingTime(duration)}`} aria-disabled={!enabled}
      accessibilityValue={{ min: 0, max: duration, now: displayed }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => change(time + (event.nativeEvent.actionName === 'increment' ? 5 : -5))}
      {...webKeyboard(event => {
        const key = event.nativeEvent.key;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        event.preventDefault(); change(key === 'Home' ? 0 : key === 'End' ? duration : time + (key === 'ArrowRight' ? 5 : -5));
      })}
      onLayout={event => { width.current = event.nativeEvent.layout.width; }}
      hitSlop={sliderHitSlop}
      // 捕获阶段就认领触摸，并拒绝把响应权让给外层 ScrollView / 列表；系统级返回手势由页面在拖动期间关闭。
      onStartShouldSetResponderCapture={() => enabled} onMoveShouldSetResponderCapture={() => enabled}
      onStartShouldSetResponder={() => enabled} onMoveShouldSetResponder={() => enabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={event => { const next = timeAt(event.nativeEvent.locationX); if (next === null) return; drag.current = { x: event.nativeEvent.pageX, offset: event.nativeEvent.locationX, time: next }; setPreview(next); onDragChange?.(true); }}
      onResponderMove={event => { if (!drag.current) return; const next = timeAt(drag.current.offset + event.nativeEvent.pageX - drag.current.x); if (next !== null) { drag.current.time = next; setPreview(next); } }}
      onResponderRelease={() => { const active = drag.current; drag.current = null; setPreview(null); if (active) { change(active.time); onDragChange?.(false); } }}
      onResponderTerminate={() => { const active = drag.current; drag.current = null; setPreview(null); if (active) onDragChange?.(false); }} style={styles.slider}>
      <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.border }]}><View style={[styles.track, { backgroundColor: theme.text, width: `${ratio * 100}%` }]} /><View style={[styles.knob, preview !== null && styles.knobActive, { backgroundColor: enabled ? theme.vermilion : theme.textMuted, left: `${ratio * 100}%` }]} /></View>
    </View><Text style={[styles.time, { color: theme.textMuted }]}>{formatSpeakingTime(duration)}</Text></View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 10, alignItems: 'center' }, slider: { flex: 1, minHeight: 36, justifyContent: 'center' }, track: { height: 2, borderRadius: 1 }, knob: { position: 'absolute', top: -4, width: 10, height: 10, marginLeft: -5, borderRadius: 5 }, knobActive: { top: -6, width: 14, height: 14, marginLeft: -7, borderRadius: 7 }, time: { fontFamily: fonts.label, fontSize: 11, minWidth: 38 } });
