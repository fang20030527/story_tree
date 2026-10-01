import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';

export interface EditorialAudioTrack {
  articleId: string;
  title: string;
  source: number | string;
}

export interface EditorialPlaybackPosition {
  currentTime: number;
  duration: number;
  playing: boolean;
}

interface PlaybackState extends EditorialPlaybackPosition {
  isLoaded: boolean;
  pending: boolean;
  failed: boolean;
  timedOut: boolean;
  playbackRate: number;
  rateError: boolean;
}

interface PlaybackController {
  toggle: () => Promise<void>;
  seek: (time: number) => Promise<void>;
  changeRate: (rate: number) => void;
  stop: () => void;
  playbackRate: number;
}

interface EditorialAudioContextValue extends PlaybackState {
  track: EditorialAudioTrack | null;
  toggleTrack: (track: EditorialAudioTrack) => void;
  toggle: () => void;
  seek: (time: number) => void;
  changeRate: (rate: number) => void;
  close: () => void;
}

type AudioSession = { id: number; track: EditorialAudioTrack; playbackRate: number };

const EMPTY_PLAYBACK: PlaybackState = {
  currentTime: 0, duration: 0, playing: false, isLoaded: false, pending: false,
  failed: false, timedOut: false, playbackRate: 1, rateError: false,
};
const LOAD_TIMEOUT_MS = 15_000;
const EditorialAudioContext = createContext<EditorialAudioContextValue | null>(null);

function applyPlaybackRate(player: ReturnType<typeof useAudioPlayer>, rate: number) {
  // Expo 播放器是可变的原生对象，通过其属性启用音调校正。
  player.shouldCorrectPitch = true;
  player.setPlaybackRate(rate, 'high');
}

export function EditorialAudioProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AudioSession | null>(null);
  const [playback, setPlayback] = useState(EMPTY_PLAYBACK);
  const sessionRef = useRef<AudioSession | null>(null);
  const nextId = useRef(0);
  const controllerRef = useRef<PlaybackController | null>(null);

  const startSession = useCallback((track: EditorialAudioTrack, playbackRate = 1) => {
    // 先取消旧音频的异步操作并暂停，再创建新会话，避免两篇文章同时发声。
    controllerRef.current?.stop();
    controllerRef.current = null;
    const next = { id: ++nextId.current, track: { ...track }, playbackRate };
    sessionRef.current = next;
    setPlayback({ ...EMPTY_PLAYBACK, playbackRate });
    setSession(next);
  }, []);

  const toggleTrack = useCallback((track: EditorialAudioTrack) => {
    const current = sessionRef.current?.track;
    if (current?.articleId === track.articleId && current.source === track.source) {
      void controllerRef.current?.toggle();
    } else {
      startSession(track);
    }
  }, [startSession]);
  const toggle = useCallback(() => { void controllerRef.current?.toggle(); }, []);
  const seek = useCallback((time: number) => { void controllerRef.current?.seek(time); }, []);
  const changeRate = useCallback((rate: number) => { controllerRef.current?.changeRate(rate); }, []);
  const close = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    sessionRef.current = null;
    setSession(null);
    setPlayback(EMPTY_PLAYBACK);
  }, []);
  const retry = useCallback(() => {
    const current = sessionRef.current;
    if (current) startSession(current.track, controllerRef.current?.playbackRate ?? current.playbackRate);
  }, [startSession]);
  const report = useCallback((id: number, state: PlaybackState) => {
    if (sessionRef.current?.id === id) setPlayback(state);
  }, []);

  const value = useMemo(() => ({
    ...playback, track: session?.track ?? null, toggleTrack, toggle, seek, changeRate, close,
  }), [playback, session, toggleTrack, toggle, seek, changeRate, close]);

  return (
    <EditorialAudioContext.Provider value={value}>
      {children}
      {session ? (
        <ActiveAudioSession key={session.id} session={session} controllerRef={controllerRef} report={report} retry={retry} />
      ) : null}
    </EditorialAudioContext.Provider>
  );
}

// 播放器由应用根部持有；切换页面只替换控制界面，不会卸载或释放音频。
function ActiveAudioSession({ session, controllerRef, report, retry }: {
  session: AudioSession;
  controllerRef: React.RefObject<PlaybackController | null>;
  report: (id: number, state: PlaybackState) => void;
  retry: () => void;
}) {
  const player = useAudioPlayer(session.track.source, {
    updateInterval: 100, downloadFirst: typeof session.track.source === 'string',
  });
  const status = useAudioPlayerStatus(player);
  const active = useRef(true);
  const busy = useRef(false);
  const autoPlay = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(session.playbackRate);
  const [rateError, setRateError] = useState(false);
  const duration = Number.isFinite(status.duration) ? Math.max(0, status.duration) : 0;
  const currentTime = Number.isFinite(status.currentTime) ? Math.min(duration, Math.max(0, status.currentTime)) : 0;
  const timedOut = loadTimedOut && !status.isLoaded && !status.error;
  const failed = error || Boolean(status.error) || timedOut;

  useEffect(() => {
    if (status.isLoaded || status.error) return;
    const timer = setTimeout(() => setLoadTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status.isLoaded, status.error]);

  const toggle = useCallback(async () => {
    if (!active.current || busy.current) return;
    if (status.error || timedOut) { retry(); return; }
    if (!status.isLoaded) return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      if (status.playing) {
        player.pause();
      } else {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
        if (!active.current) return;
        if (status.didJustFinish || (duration > 0 && currentTime >= duration)) await player.seekTo(0);
        if (!active.current) return;
        applyPlaybackRate(player, playbackRate);
        player.play();
      }
    } catch {
      if (active.current) setError(true);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }, [player, status.isLoaded, status.error, status.playing, status.didJustFinish, timedOut, duration, currentTime, playbackRate, retry]);

  const seek = useCallback(async (time: number) => {
    if (!active.current || busy.current || !status.isLoaded || status.error || !duration || !Number.isFinite(time)) return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      await player.seekTo(Math.max(0, Math.min(duration, time)));
    } catch {
      if (active.current) setError(true);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }, [player, status.isLoaded, status.error, duration]);

  const changeRate = useCallback((rate: number) => {
    if (!active.current || busy.current || !status.isLoaded || status.error) return;
    try {
      applyPlaybackRate(player, rate);
      setPlaybackRate(rate);
      setRateError(false);
    } catch {
      setRateError(true);
    }
  }, [player, status.isLoaded, status.error]);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      // 必须在 Expo 的被动清理释放原生播放器前取消后续调用。
      active.current = false;
      controllerRef.current = null;
    };
  }, [player, controllerRef]);

  useLayoutEffect(() => {
    controllerRef.current = {
      toggle, seek, changeRate, playbackRate,
      stop: () => {
        if (!active.current) return;
        active.current = false;
        autoPlay.current = false;
        try { player.pause(); } catch { /* 卸载后仍会由 Expo 释放播放器。 */ }
      },
    };
  }, [player, controllerRef, toggle, seek, changeRate, playbackRate]);

  useEffect(() => {
    if (!autoPlay.current || !status.isLoaded || status.error || timedOut) return;
    autoPlay.current = false;
    void toggle();
  }, [status.isLoaded, status.error, timedOut, toggle]);

  const state = useMemo(() => ({
    currentTime, duration, playing: status.playing, isLoaded: status.isLoaded,
    pending, failed, timedOut, playbackRate, rateError,
  }), [currentTime, duration, status.playing, status.isLoaded, pending, failed, timedOut, playbackRate, rateError]);
  useEffect(() => { report(session.id, state); }, [session.id, state, report]);

  return null;
}

export function useEditorialAudio() {
  const context = useContext(EditorialAudioContext);
  if (!context) throw new Error('useEditorialAudio must be used within EditorialAudioProvider');
  return context;
}

export function formatEditorialAudioTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
