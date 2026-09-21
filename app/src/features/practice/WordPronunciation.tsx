import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

let latestPlayback = 0;

interface Props {
  term: string;
  phoneticUk?: string | null;
  phoneticUs?: string | null;
  color?: string;
}

export function WordPronunciation({ term, phoneticUk, phoneticUs, color = '#000000' }: Props) {
  const [error, setError] = useState<string | null>(null);
  const playbackRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (playbackRef.current === latestPlayback) {
      latestPlayback += 1;
      void Speech.stop().catch(() => undefined);
    }
    playbackRef.current = null;
  }, [term]);

  const play = async (language: 'en-GB' | 'en-US', label: string) => {
    const playback = ++latestPlayback;
    playbackRef.current = playback;
    setError(null);
    const isCurrent = () => latestPlayback === playback && playbackRef.current === playback;
    try {
      await Speech.stop();
      const voices = await Speech.getAvailableVoicesAsync();
      if (!isCurrent()) return;
      const voice = voices.find((item) => item.language.replace('_', '-').toLowerCase() === language.toLowerCase());
      if (!voice) {
        setError(`设备暂无${label}语音，请在系统语音设置中添加后重试`);
        return;
      }
      Speech.speak(term, {
        language,
        voice: voice.identifier,
        rate: 0.85,
        onError: () => {
          if (isCurrent()) setError('发音播放失败，请重试');
        },
      });
    } catch {
      if (isCurrent()) setError('发音播放失败，请重试');
    }
  };

  return (
    <View style={styles.container}>
      {([
        { label: '英式', language: 'en-GB', phonetic: phoneticUk },
        { label: '美式', language: 'en-US', phonetic: phoneticUs },
      ] as const).map(({ label, language, phonetic }) => (
        <TouchableOpacity
          key={language}
          accessibilityLabel={`播放${label}发音`}
          accessibilityRole="button"
          onPress={() => void play(language, label)}
          style={styles.pronunciation}>
          <Text style={[styles.label, { color }]}>{label}</Text>
          <Text style={[styles.phonetic, { color }]}>{phonetic || '音标暂缺'}</Text>
          <Ionicons name="volume-medium-outline" size={18} color={color} />
        </TouchableOpacity>
      ))}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 6 },
  pronunciation: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, minHeight: 44 },
  label: { fontSize: 12, fontWeight: '600' },
  phonetic: { fontSize: 14, flexShrink: 1 },
  error: { color: '#dc2626', fontSize: 12, lineHeight: 18 },
});
