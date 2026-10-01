import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useCallback, useEffect, useMemo } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { initialShadowingState, type ShadowingController, type ShadowingPlaybackState } from './playback';
type Props = { source: string | number; title: string; expanded: boolean; frameWidth?: number; maxHeight?: number; onController: (controller: ShadowingController | null) => void; onState: (state: ShadowingPlaybackState) => void };
function audioRate(player: ReturnType<typeof useAudioPlayer>, rate: number) { player.shouldCorrectPitch = true; player.setPlaybackRate(rate); }
function videoSeek(player: ReturnType<typeof useVideoPlayer>, time: number) { player.currentTime = time; }
function videoRate(player: ReturnType<typeof useVideoPlayer>, rate: number) { player.playbackRate = rate; }
function videoUpdates(player: ReturnType<typeof useVideoPlayer>, interval: number) { player.timeUpdateEventInterval = interval; }

export function ShadowingAudio(props: Props) {
  const { theme } = useAppTheme();
  const player = useAudioPlayer(props.source, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const { onController, onState } = props;
  const controller = useMemo<ShadowingController>(() => ({
    play: () => player.play(), pause: () => player.pause(), seek: time => player.seekTo(time),
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
  return <View style={[styles.audio, { backgroundColor: theme.pink, minHeight: props.expanded ? 260 : 146 }]}><Text style={{ color: theme.onPink, fontSize: 10, letterSpacing: 2 }}>LISTEN. REPEAT. SPEAK.</Text><Text numberOfLines={2} style={{ color: theme.onPink, fontFamily: fonts.display, fontSize: 30, lineHeight: 34, marginTop: 16 }}>{props.title}</Text><View accessibilityElementsHidden style={styles.wave}>{[12, 26, 36, 21, 45, 19, 31, 24, 42, 14].map((height, i) => <View key={i} style={{ height, width: 3, backgroundColor: theme.onPink, opacity: status.playing ? 1 : .5 }} />)}</View></View>;
}
export const ShadowingVideo = React.memo(function ShadowingVideo(props: Props) {
  const { width, height } = useWindowDimensions();
  const aspectHeight = Math.max(170, (props.frameWidth || Math.min(width, 960) - 40) * 9 / 16);
  const preferredHeight = props.expanded ? Math.max(300, Math.min(aspectHeight, height * .68)) : Math.min(aspectHeight, Math.max(170, height * .42));
  const videoHeight = Math.min(preferredHeight, props.maxHeight ?? preferredHeight);
  const player = useVideoPlayer(props.source);
  const { onController, onState } = props;
  const controller = useMemo<ShadowingController>(() => ({ play: () => player.play(), pause: () => player.pause(), seek: async time => videoSeek(player, time), setRate: rate => videoRate(player, rate) }), [player]);
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
  return <VideoView player={player} nativeControls={false} contentFit="contain" style={{ height: videoHeight, width: '100%', backgroundColor: '#191B17' }} />;
});
const styles = StyleSheet.create({ audio: { padding: 22, borderRadius: 3 }, wave: { flexDirection: 'row', gap: 7, alignItems: 'center', height: 40, marginTop: 12 } });
