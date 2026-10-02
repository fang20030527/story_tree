import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { formatSpeakingTime } from './model';
import { webKeyboard } from '@/components/webKeyboard';

export function ShadowingProgress({ time, duration, enabled, seek }: { time: number; duration: number; enabled: boolean; seek: (time: number) => void }) {
  const { theme } = useAppTheme();
  const width = useRef(1);
  const drag = useRef<{ x: number; offset: number; time: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const displayed = preview ?? time;
  const timeAt = (offset: number) => Math.max(0, Math.min(1, offset / width.current)) * duration;
  const change = (next: number) => { if (enabled) seek(Math.max(0, Math.min(duration, next))); };
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
      onStartShouldSetResponder={() => enabled} onMoveShouldSetResponder={() => enabled}
      onResponderGrant={event => { const next = timeAt(event.nativeEvent.locationX); drag.current = { x: event.nativeEvent.pageX, offset: event.nativeEvent.locationX, time: next }; setPreview(next); }}
      onResponderMove={event => { if (drag.current) { drag.current.time = timeAt(drag.current.offset + event.nativeEvent.pageX - drag.current.x); setPreview(drag.current.time); } }}
      onResponderRelease={() => { if (drag.current) change(drag.current.time); drag.current = null; setPreview(null); }}
      onResponderTerminate={() => { drag.current = null; setPreview(null); }} style={styles.slider}>
      <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.border }]}><View style={[styles.track, { backgroundColor: theme.text, width: `${ratio * 100}%` }]} /><View style={[styles.knob, { backgroundColor: enabled ? theme.vermilion : theme.textMuted, left: `${ratio * 100}%` }]} /></View>
    </View><Text style={[styles.time, { color: theme.textMuted }]}>{formatSpeakingTime(duration)}</Text></View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 10, alignItems: 'center' }, slider: { flex: 1, minHeight: 30, justifyContent: 'center' }, track: { height: 2, borderRadius: 1 }, knob: { position: 'absolute', top: -4, width: 10, height: 10, marginLeft: -5, borderRadius: 5 }, time: { fontFamily: fonts.label, fontSize: 11, minWidth: 38 } });
