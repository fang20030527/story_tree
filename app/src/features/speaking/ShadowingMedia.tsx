import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { fonts, orbitTilt, radius } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingTitleText } from './titles';
import { initialShadowingState, type ShadowingController, type ShadowingPlaybackState } from './playback';
import { clampSeekTarget, createSeekCoalescer } from './seekCoalescer';
import type { SpeakingCue } from './model';
import { ShadowingVideoSubtitles } from './ShadowingVideoSubtitles';
type Props = { source: string | number; title: string; expanded: boolean; frameWidth?: number; maxHeight?: number; onController: (controller: ShadowingController | null) => void; onState: (state: ShadowingPlaybackState) => void };
function audioRate(player: ReturnType<typeof useAudioPlayer>, rate: number) { player.shouldCorrectPitch = true; player.setPlaybackRate(rate); }
function videoSeek(player: ReturnType<typeof useVideoPlayer>, time: number) { player.currentTime = time; }
function videoPause(player: ReturnType<typeof useVideoPlayer>) { try { player.pause(); } catch { /* 播放器可能已被原生端释放。 */ } }
function videoRate(player: ReturnType<typeof useVideoPlayer>, rate: number) { player.playbackRate = rate; }
function videoUpdates(player: ReturnType<typeof useVideoPlayer>, interval: number) { player.timeUpdateEventInterval = interval; }

export function ShadowingAudio(props: Props) {
  const { theme } = useAppTheme();
  const player = useAudioPlayer(props.source, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const { onController, onState } = props;
  const controller = useMemo<ShadowingController>(() => ({
    play: () => player.play(), pause: () => player.pause(),
    seek: async time => { const target = clampSeekTarget(time, player.duration); if (target !== null) await player.seekTo(target); },
    setRate: rate => audioRate(player, rate),
  }), [player]);
  useEffect(() => {
    let active = true;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' })
      .then(() => { if (active) onController(controller); }).catch(() => { if (active) onState({ ...initialShadowingState, error: '音频初始化失败，请重试' }); });
    return () => { active = false; onController(null); };
  }, [controller, onController, onState]);
  useEffect(() => {
    const failed = status.playbackState === 'error';
    onState({ currentTime: status.currentTime, duration: status.duration, playing: status.playing, loaded: status.isLoaded, error: failed ? '音频播放失败，请检查文件格式后重试' : '', finished: status.didJustFinish });
  }, [status.currentTime, status.duration, status.playing, status.isLoaded, status.playbackState, status.didJustFinish, onState]);
  const hole = theme.mode === 'dark' ? theme.bg : theme.text;
  return <View style={[styles.audio, { backgroundColor: theme.surfaceAlt, minHeight: props.expanded ? 260 : 146 }]}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <View style={[styles.orbit, { backgroundColor: theme.vermilion, transform: [{ rotate: orbitTilt }] }]} />
      <View style={[styles.hole, { backgroundColor: hole, transform: [{ rotate: orbitTilt }] }]} />
    </View>
    <Text style={{ color: theme.text, fontFamily: fonts.label, fontSize: 10, letterSpacing: 2 }}>LISTEN · REPEAT · SPEAK</Text>
    <View style={{ flex: 1 }} />
    <Text numberOfLines={2} style={{ color: theme.text, fontSize: 22, lineHeight: 28, fontWeight: '700', marginTop: 16, maxWidth: '60%' }}>{speakingTitleText(props.title)}</Text>
    <View accessibilityElementsHidden style={styles.wave}>{[12, 26, 36, 21, 45, 19, 31, 24, 42, 14].map((height, i) => <View key={i} style={{ height, width: 3, borderRadius: 1.5, backgroundColor: theme.text, opacity: status.playing ? 1 : .45 }} />)}</View></View>;
}
export const ShadowingVideo = React.memo(function ShadowingVideo(props: Props & { subtitleCue?: SpeakingCue | null }) {
  const { width, height } = useWindowDimensions();
  const videoView = useRef<VideoView>(null);
  const videoFrame = useRef<View>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const aspectHeight = Math.max(170, (props.frameWidth || Math.min(width, 960) - 40) * 9 / 16);
  const preferredHeight = props.expanded ? Math.max(300, Math.min(aspectHeight, height * .68)) : Math.min(aspectHeight, Math.max(170, height * .42));
  const videoHeight = Math.min(preferredHeight, props.maxHeight ?? preferredHeight);
  const player = useVideoPlayer(props.source);
  const { onController, onState } = props;
  // 连续拖动进度条时只保留最后一个目标，每 250ms 最多向原生播放器定位一次。
  const seeks = useMemo(() => createSeekCoalescer(time => videoSeek(player, time)), [player]);
  const controller = useMemo<ShadowingController>(() => ({
    play: () => player.play(), pause: () => player.pause(), setRate: rate => videoRate(player, rate),
    seek: time => { const target = clampSeekTarget(time, player.duration); return target === null ? Promise.resolve() : seeks.request(target); },
    enterFullscreen: async () => {
      // Web 将字幕与视频所在的容器一起全屏，保持同一个播放器和播放位置。
      const frame = Platform.OS === 'web' ? videoFrame.current as unknown as HTMLElement | null : null;
      if (frame?.requestFullscreen) { await frame.requestFullscreen(); return; }
      if (!videoView.current) throw new Error('视频尚未就绪');
      await videoView.current.enterFullscreen();
    },
  }), [player, seeks]);
  const report = useCallback((finished = false) => onState({ currentTime: player.currentTime, duration: player.duration, playing: player.playing, loaded: player.status === 'readyToPlay', error: player.status === 'error' ? '视频播放失败，请检查文件格式后重试' : '', finished }), [player, onState]);
  useEffect(() => {
    onController(controller); report();
    const subscriptions = [player.addListener('timeUpdate', () => report()), player.addListener('playingChange', () => report()), player.addListener('statusChange', () => report()), player.addListener('sourceLoad', () => report()), player.addListener('playToEnd', () => report(true))];
    videoUpdates(player, .1);
    return () => {
      // The native hook releases its player; the Web hook leaves its timer running.
      if (Platform.OS === 'web') videoUpdates(player, 0);
      subscriptions.forEach(subscription => subscription.remove()); onController(null);
    };
  }, [player, controller, report, onController]);
  // 布局清理先于播放器 hook 的释放执行：丢弃未发出的定位，并在释放前暂停。
  useLayoutEffect(() => () => { seeks.cancel(); videoPause(player); }, [player, seeks]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onFullscreenChange = () => {
      const frame = videoFrame.current as unknown as HTMLElement | null;
      const element = document.fullscreenElement;
      setFullscreen(Boolean(frame && element && (element === frame || frame.contains(element))));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  // 换句或补齐译文只更新字幕，不重新挂载 Expo 的 VideoView。
  const video = useMemo(() => <VideoView ref={videoView} player={player} nativeControls={fullscreen} fullscreenOptions={{ enable: true }}
    onFullscreenEnter={() => setFullscreen(true)} onFullscreenExit={() => setFullscreen(false)}
    contentFit="contain" style={styles.video} />, [player, fullscreen]);
  return <View ref={videoFrame} style={{ height: fullscreen && Platform.OS === 'web' ? '100%' : videoHeight, width: '100%', backgroundColor: '#191B17' }}>
    {video}
    <ShadowingVideoSubtitles cue={props.subtitleCue ?? null} frameWidth={fullscreen ? width : props.frameWidth || Math.min(width, 960) - 40} fullscreen={fullscreen} />
  </View>;
});
const styles = StyleSheet.create({ video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }, audio: { padding: 22, borderRadius: radius.content, overflow: 'hidden' }, orbit: { position: 'absolute', right: '-18%', top: '-30%', width: '78%', height: '120%', borderRadius: '50%' }, hole: { position: 'absolute', right: '20%', top: '26%', width: '22%', height: '30%', borderRadius: '50%' }, wave: { flexDirection: 'row', gap: 7, alignItems: 'center', height: 40, marginTop: 12 } });
