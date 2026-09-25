import { Ionicons } from '@expo/vector-icons';
import { Host, Picker } from '@expo/ui';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppTheme } from '@/context/ThemeContext';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const LOAD_TIMEOUT_MS = 15_000;

function applyPlaybackRate(player: ReturnType<typeof useAudioPlayer>, rate: number) {
  // Expo 播放器是可变的原生对象，通过其属性启用音调校正。
  player.shouldCorrectPitch = true;
  player.setPlaybackRate(rate, 'high');
}

export interface EditorialPlaybackPosition {
  currentTime: number;
  duration: number;
  playing: boolean;
}

export function EditorialAudioPlayer({ source, onPositionChange }: {
  source: number | string;
  onPositionChange?: (position: EditorialPlaybackPosition) => void;
}) {
  const { theme } = useAppTheme();
  const player = useAudioPlayer(source, { updateInterval: 100, downloadFirst: typeof source === 'string' });
  const status = useAudioPlayerStatus(player);
  const active = useRef(false);
  const livePlayer = useRef<typeof player | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [rateError, setRateError] = useState(false);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const trackWidth = useRef(0);
  const drag = useRef<{ pageX: number; locationX: number; time: number } | null>(null);
  const duration = Number.isFinite(status.duration) ? Math.max(0, status.duration) : 0;
  const currentTime = Math.min(duration, Math.max(0, status.currentTime || 0));

  useEffect(() => {
    if (status.isLoaded || status.error) return;
    const timer = setTimeout(() => setLoadTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [source, status.isLoaded, status.error, loadAttempt]);

  useEffect(() => {
    onPositionChange?.({ currentTime, duration, playing: status.playing });
  }, [currentTime, duration, status.playing, onPositionChange]);

  const seek = async (time: number) => {
    if (busy.current || !active.current || !status.isLoaded || !duration) return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      await player.seekTo(Math.max(0, Math.min(duration, time)));
    } catch {
      if (active.current) setError(true);
    } finally {
      busy.current = false;
      if (active.current) { setPending(false); setPreviewTime(null); }
    }
  };

  useLayoutEffect(() => {
    livePlayer.current = player;
    return () => {
      // 在 Expo 的被动清理释放原生播放器之前，阻止后续调用。
      livePlayer.current = null;
      active.current = false;
    };
  }, [player]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    setPending(busy.current);
    return () => {
      active.current = false;
      // 失焦时暂停；卸载时由 useAudioPlayer 负责停止并释放。
      if (livePlayer.current === player) player.pause();
    };
  }, [player]));

  const toggle = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      if (status.playing) {
        player.pause();
      } else if (status.error || loadTimedOut) {
        setLoadTimedOut(false);
        setLoadAttempt((current) => current + 1);
        player.replace(source);
      } else {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
        if (!active.current) return;
        if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
          await player.seekTo(0);
        }
        if (active.current) {
          applyPlaybackRate(player, playbackRate);
          player.play();
        }
      }
    } catch {
      if (active.current) setError(true);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  };

  const timedOut = loadTimedOut && !status.isLoaded && !status.error;
  const failed = error || Boolean(status.error) || timedOut;
  const loading = !status.isLoaded && !failed;
  const canSeek = status.isLoaded && duration > 0 && !pending && !status.error;
  const canChangeRate = status.isLoaded && !pending && !status.error;
  const changeRate = (rate: number) => {
    if (!canChangeRate || busy.current || !active.current) return;
    try {
      applyPlaybackRate(player, rate);
      setPlaybackRate(rate);
      setRateError(false);
    } catch {
      setRateError(true);
    }
  };
  const displayedTime = previewTime ?? currentTime;
  const progress = duration > 0 ? displayedTime / duration : 0;
  const timeAt = (x: number) => Math.max(0, Math.min(1, x / (trackWidth.current || 1))) * duration;
  const label = failed ? '重试音频' : loading ? '音频加载中' : status.playing ? '暂停音频' : '播放音频';

  return (
    <View style={[styles.container, { backgroundColor: theme.surfaceAlt }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: loading || pending, busy: loading || pending }}
        disabled={loading || pending}
        onPress={() => void toggle()}
        style={styles.button}>
        <Ionicons name={status.playing ? 'pause-circle' : 'play-circle'} size={32} color={theme.accent} />
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
          setPreviewTime(time);
        }}
        onResponderMove={(event) => {
          if (!drag.current) return;
          drag.current.time = timeAt(drag.current.locationX + event.nativeEvent.pageX - drag.current.pageX);
          setPreviewTime(drag.current.time);
        }}
        onResponderRelease={() => {
          const time = drag.current?.time;
          drag.current = null;
          if (time !== undefined) void seek(time);
        }}
        onResponderTerminate={() => { drag.current = null; setPreviewTime(null); }}
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
      {rateError ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger }}>倍速调整失败，请重试</Text> : null}
      {failed ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger }}>
        {timedOut ? '音频加载超时，请重试' : '音频播放失败，请重试'}
      </Text> : null}
    </View>
  );
}

function formatTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
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
