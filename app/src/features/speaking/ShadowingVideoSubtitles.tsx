import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, radius } from '@/constants/theme';
import type { SpeakingCue } from './model';

/** 视频画面内的字幕独立于台词列表的语言、搜索、收藏和遮挡设置。 */
export const ShadowingVideoSubtitles = React.memo(function ShadowingVideoSubtitles({ cue, frameWidth, fullscreen = false }: {
  cue: SpeakingCue | null; frameWidth: number; fullscreen?: boolean;
}) {
  if (!cue) return null;
  const fontSize = Math.round(Math.max(15, Math.min(25, frameWidth / 30)));
  return <View testID="video-subtitles" style={[styles.overlay, fullscreen && { bottom: 72 }]}>
    <View style={styles.caption}>
      <Text testID="video-subtitle-en" numberOfLines={2} style={[styles.text, { fontFamily: fonts.label, fontSize, lineHeight: fontSize * 1.35 }]}>{cue.en}</Text>
      {cue.zh.trim() ? <Text testID="video-subtitle-zh" numberOfLines={2} style={[styles.text, { fontSize: fontSize - 2, lineHeight: (fontSize - 2) * 1.4, marginTop: 2 }]}>{cue.zh}</Text> : null}
    </View>
  </View>;
});

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: '5%', right: '5%', bottom: '6%', alignItems: 'center', pointerEvents: 'none' },
  caption: { maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.content, backgroundColor: 'rgba(0, 0, 0, 0.65)' },
  text: { color: '#FFFFFF', textAlign: 'center' },
});
