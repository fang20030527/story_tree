import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';

import { useLayoutWidth } from '@/components/useLayoutWidth';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { formatEditorialAudioTime, useEditorialAudio, type EditorialAudioTrack } from './EditorialAudioProvider';

export function FloatingEditorialAudioPlayer() {
  const audio = useEditorialAudio();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const width = useLayoutWidth();
  const [collapsedTrack, setCollapsedTrack] = useState<EditorialAudioTrack | null>(null);
  const track = audio.track;
  if (!track) return null;

  const collapsed = collapsedTrack === track;
  const loading = !audio.isLoaded && !audio.failed;
  const finished = audio.duration > 0 && audio.currentTime >= audio.duration && !audio.playing;
  const stateLabel = audio.failed ? '播放失败，点击重试' : loading ? '音频加载中…'
    : audio.playing ? '正在播放' : finished ? '播放结束' : '已暂停';
  const toggleLabel = audio.failed ? '重试悬浮音频' : audio.playing ? '暂停悬浮音频' : '播放悬浮音频';
  const progress = audio.duration > 0 ? audio.currentTime / audio.duration : 0;

  const floatingPlayer = (
    <View testID="floating-editorial-audio" style={[
      styles.container,
      collapsed && styles.collapsedContainer,
      {
        backgroundColor: theme.surface, borderColor: theme.border,
        right: collapsed ? insets.right : Math.max(16, insets.right),
        // 手机上避开底部标签栏和概述页的“开始阅读”按钮。
        bottom: insets.bottom + (width >= 768 ? 24 : 88),
      },
    ]}>
      {collapsed ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="展开播放器"
          accessibilityHint={`${track.title}，${stateLabel}，点击展开音频控制`}
          accessibilityState={{ expanded: false }}
          onPress={() => setCollapsedTrack(null)}
          style={styles.expandButton}>
          <Ionicons name="headset-outline" size={21} color={theme.accent} />
          <Ionicons name="chevron-back" size={16} color={theme.textMuted} />
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`返回文章：${track.title}`}
            accessibilityHint="打开文章正文，继续阅读"
            onPress={() => router.navigate({ pathname: '/editorial/[id]/read', params: { id: track.articleId } })}
            style={styles.articleButton}>
            <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="headset-outline" size={21} color={theme.accent} />
            </View>
            <View style={styles.caption}>
              <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>{track.title}</Text>
              <Text numberOfLines={1} style={[styles.status, { color: theme.textMuted }]}>
                {stateLabel}{audio.isLoaded && !audio.failed ? ` · ${formatEditorialAudioTime(audio.currentTime)}` : ''}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={toggleLabel}
            accessibilityState={{ disabled: loading || audio.pending, busy: loading || audio.pending }}
            disabled={loading || audio.pending}
            onPress={audio.toggle}
            style={styles.control}>
            {loading || audio.pending ? <ActivityIndicator size="small" color={theme.accent} /> : (
              <Ionicons name={audio.failed ? 'reload' : audio.playing ? 'pause' : 'play'} size={22} color={theme.accent} />
            )}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭文章音频"
            onPress={audio.close} style={styles.control}>
            <Ionicons name="close" size={21} color={theme.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="收起播放器"
            accessibilityHint="收至右侧，音频继续播放"
            accessibilityState={{ expanded: true }}
            onPress={() => setCollapsedTrack(track)}
            style={styles.control}>
            <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
          </TouchableOpacity>
          <View pointerEvents="none" style={[styles.progress, { backgroundColor: theme.border }]}>
            <View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: theme.accent }} />
          </View>
        </>
      )}
    </View>
  );

  // iOS 的原生模态页在导航容器上方，悬浮控制需要放到窗口层。
  return Platform.OS === 'ios' ? (
    <FullWindowOverlay>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{floatingPlayer}</View>
    </FullWindowOverlay>
  ) : floatingPlayer;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute', zIndex: 100, elevation: 12, width: 336, maxWidth: '92%',
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 8,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 12,
  },
  collapsedContainer: { width: 48, padding: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  expandButton: { width: 48, height: 60, alignItems: 'center', justifyContent: 'center', gap: 3 },
  articleButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  caption: { flex: 1, gap: 4 },
  title: { fontSize: 13, fontWeight: weight('semibold') },
  status: { fontSize: 11 },
  control: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  progress: { position: 'absolute', bottom: 4, left: 16, right: 16, height: 2, overflow: 'hidden', borderRadius: 1 },
});
