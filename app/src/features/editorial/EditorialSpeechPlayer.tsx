import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppTheme } from '@/context/ThemeContext';

const MAX_CHUNK_LENGTH = 1200;

function speechChunks(paragraphs: readonly string[]): string[] {
  const limit = Math.min(MAX_CHUNK_LENGTH, Math.max(1, Speech.maxSpeechInputLength));
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    let remaining = paragraph.trim();
    while (remaining.length > limit) {
      const breakAt = remaining.lastIndexOf(' ', limit);
      const length = breakAt > limit / 2 ? breakAt : limit;
      chunks.push(remaining.slice(0, length).trim());
      remaining = remaining.slice(length).trim();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks;
}

/** 仅在用户按下播放时读取正文，避免概述页提前加载整期 EPUB。 */
export function EditorialSpeechPlayer({ loadText }: { loadText: () => readonly string[] }) {
  const { theme } = useAppTheme();
  const active = useRef(false);
  const speaking = useRef(false);
  const run = useRef(0);
  const chunks = useRef<string[]>([]);
  const [state, setState] = useState<'idle' | 'starting' | 'speaking' | 'error'>('idle');
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0);
  const [finished, setFinished] = useState(false);

  useFocusEffect(useCallback(() => {
    active.current = true;
    if (!speaking.current) setState('idle');
    return () => {
      active.current = false;
      run.current += 1;
      if (speaking.current) {
        speaking.current = false;
        void Speech.stop().catch(() => undefined);
      }
    };
  }, []));

  const speakChunk = (index: number, currentRun: number) => {
    if (!active.current || run.current !== currentRun) return;
    const text = chunks.current[index];
    if (!text) {
      speaking.current = false;
      setFinished(true);
      setState('idle');
      return;
    }
    setPosition(index + 1);
    setState('speaking');
    try {
      Speech.speak(text, {
        language: 'en-US',
        useApplicationAudioSession: true,
        onDone: () => {
          if (active.current && run.current === currentRun) speakChunk(index + 1, currentRun);
        },
        onError: () => {
          if (active.current && run.current === currentRun) {
            speaking.current = false;
            setState('error');
          }
        },
      });
    } catch {
      speaking.current = false;
      setState('error');
    }
  };

  const toggle = async () => {
    if (state === 'starting') return;
    const currentRun = ++run.current;
    if (speaking.current) {
      speaking.current = false;
      setState('idle');
      setPosition(0);
      setFinished(false);
      try { await Speech.stop(); } catch { if (active.current) setState('error'); }
      return;
    }
    setState('starting');
    setFinished(false);
    setPosition(0);
    try {
      const nextChunks = speechChunks(loadText());
      if (!nextChunks.length) throw new Error('empty article');
      chunks.current = nextChunks;
      setTotal(nextChunks.length);
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
      if (!active.current || run.current !== currentRun) return;
      await Speech.stop();
      if (!active.current || run.current !== currentRun) return;
      speaking.current = true;
      speakChunk(0, currentRun);
    } catch {
      if (active.current && run.current === currentRun) setState('error');
    }
  };

  const label = state === 'starting' ? '正在准备AI配音'
    : state === 'speaking' ? '停止AI配音'
      : finished ? '重新播放AI配音' : '播放AI配音';

  return (
    <View style={[styles.container, { backgroundColor: theme.surfaceAlt }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: state === 'starting', busy: state === 'starting' }}
        disabled={state === 'starting'}
        onPress={() => void toggle()}
        style={styles.button}>
        <Ionicons name={state === 'speaking' ? 'stop-circle' : 'play-circle'} size={32} color={theme.accent} />
        <Text style={{ color: theme.text }}>{label}</Text>
      </TouchableOpacity>
      <Text style={{ color: theme.textMuted }}>AI配音 · 非原刊录音</Text>
      {position > 0 ? <Text style={{ color: theme.textMuted }}>朗读片段 {position} / {total}</Text> : null}
      {state === 'error' ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger }}>朗读失败，请重试</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, borderRadius: 12, gap: 8, marginVertical: 12 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
});
