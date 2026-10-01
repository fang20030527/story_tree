import { Ionicons } from '@expo/vector-icons';
import { Host, Picker } from '@expo/ui';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppTheme } from '@/context/ThemeContext';
import {
  formatEditorialAudioTime as formatTime, useEditorialAudio,
  type EditorialAudioTrack, type EditorialPlaybackPosition,
} from './EditorialAudioProvider';

export type { EditorialPlaybackPosition } from './EditorialAudioProvider';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function EditorialAudioPlayer({ articleId, title, source, onPositionChange }: EditorialAudioTrack & {
  onPositionChange?: (position: EditorialPlaybackPosition) => void;
}) {
  const { theme } = useAppTheme();
  const audio = useEditorialAudio();
  const selected = audio.track?.articleId === articleId && audio.track.source === source;
  const { seek, changeRate } = audio;
  const currentTime = selected ? audio.currentTime : 0;
  const duration = selected ? audio.duration : 0;
  const playing = selected && audio.playing;
  const pending = selected && audio.pending;
  const failed = selected && audio.failed;
  const loading = selected && !audio.isLoaded && !failed;
  const playbackRate = selected ? audio.playbackRate : 1;
  const [preview, setPreview] = useState<{ track: EditorialAudioTrack; time: number } | null>(null);
  const trackWidth = useRef(0);
  const drag = useRef<{ pageX: number; locationX: number; time: number } | null>(null);

  useEffect(() => {
    drag.current = null;
  }, [articleId, source, selected, pending]);

  useEffect(() => {
    onPositionChange?.({ currentTime, duration, playing });
  }, [currentTime, duration, playing, onPositionChange]);

  const canSeek = selected && audio.isLoaded && duration > 0 && !pending && !failed;
  const canChangeRate = selected && audio.isLoaded && !pending && !failed;
  const displayedTime = selected && !pending && preview?.track === audio.track ? preview.time : currentTime;
  const progress = duration > 0 ? displayedTime / duration : 0;
  const timeAt = (x: number) => Math.max(0, Math.min(1, x / (trackWidth.current || 1))) * duration;
  const label = failed ? '重试音频' : loading ? '音频加载中' : playing ? '暂停音频' : '播放音频';

  return (
    <View style={[styles.container, { backgroundColor: theme.surfaceAlt }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: loading || pending, busy: loading || pending }}
        disabled={loading || pending}
        onPress={() => audio.toggleTrack({ articleId, title, source })}
        style={styles.button}>
        <Ionicons name={playing ? 'pause-circle' : 'play-circle'} size={32} color={theme.accent} />
        <Text style={{ color: theme.text }}>{label}</Text>
      </TouchableOpacity>
      <View
        testID="editorial-audio-progress"
        accessibilityRole="adjustable"
        accessibilityLabel="音频进度"
        accessibilityHint="左右拖动调整播放位置，辅助功能每次调整十秒"
        accessibilityState={{ disabled: !canSeek }}
        accessibilityValue={{ min: 0, max: duration, now: displayedTime, text: `${formatTime(displayedTime)} / ${formatTime(duration)}` }}
        accessibilityActions={[{ name: 'increment', label: '前进十秒' }, { name: 'decrement', label: '后退十秒' }]}
        onAccessibilityAction={(event) => {
          if (canSeek) void seek(currentTime + (event.nativeEvent.actionName === 'increment' ? 10 : -10));
        }}
        onLayout={(event) => { trackWidth.current = event.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => canSeek}
        onMoveShouldSetResponder={() => canSeek}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          const { pageX, locationX } = event.nativeEvent;
          const time = timeAt(locationX);
          drag.current = { pageX, locationX, time };
          if (audio.track) setPreview({ track: audio.track, time });
        }}
        onResponderMove={(event) => {
          if (!drag.current) return;
          drag.current.time = timeAt(drag.current.locationX + event.nativeEvent.pageX - drag.current.pageX);
          if (audio.track) setPreview({ track: audio.track, time: drag.current.time });
        }}
        onResponderRelease={() => {
          const time = drag.current?.time;
          drag.current = null;
          setPreview(null);
          if (canSeek && time !== undefined) seek(time);
        }}
        onResponderTerminate={() => { drag.current = null; setPreview(null); }}
        style={[styles.progressTouch, { opacity: canSeek ? 1 : 0.45 }]}>
        <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.border }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: theme.blue }]} />
          <View style={[styles.thumb, { left: `${progress * 100}%`, backgroundColor: theme.blue }]} />
        </View>
      </View>
      <Text style={{ color: theme.textMuted }}>{formatTime(displayedTime)} / {formatTime(duration)}</Text>
      <Text style={{ color: theme.textMuted }}>原刊录音</Text>
      <View style={styles.rates}>
        <Text style={{ color: theme.textMuted }}>倍速</Text>
        <Host
          matchContents={{ vertical: true }}
          colorScheme={theme.mode}
          seedColor={theme.accent}
          style={[styles.ratePickerHost, { opacity: canChangeRate ? 1 : 0.45 }]}>
          <Picker
            testID="editorial-audio-rate-picker"
            selectedValue={playbackRate}
            enabled={canChangeRate}
            onValueChange={changeRate}>
            {PLAYBACK_RATES.map((rate) => (
              <Picker.Item key={rate} label={`${rate}×`} value={rate} />
            ))}
          </Picker>
        </Host>
      </View>
      {selected && audio.rateError ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger }}>倍速调整失败，请重试</Text> : null}
      {failed ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger }}>
        {audio.timedOut ? '音频加载超时，请重试' : '音频播放失败，请重试'}
      </Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, borderRadius: 12, gap: 8, marginVertical: 12 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  rates: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ratePickerHost: { minWidth: 112, minHeight: 44 },
  progressTouch: { height: 44, justifyContent: 'center', marginHorizontal: 8 },
  track: { height: 4, borderRadius: 2 },
  fill: { height: 4, borderRadius: 2 },
  thumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, top: -6, marginLeft: -8 },
});
