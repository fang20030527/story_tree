import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { currentCueIndex, type SpeakingCue } from './model';
import { initialShadowingState, type ShadowingController, type ShadowingPlaybackState } from './playback';

export type ShadowingLoop = { kind: 'sentence' | 'ab'; start: number; end: number };
export function useShadowingPlayback(cues: SpeakingCue[]) {
  const [state, setState] = useState(initialShadowingState);
  const controller = useRef<ShadowingController | null>(null);
  const [error, setError] = useState('');
  const [rate, setRate] = useState(1);
  const rateRef = useRef(1);
  const [repeatCount, setRepeatCount] = useState(3);
  const [gap, setGap] = useState(1);
  const [loop, setLoop] = useState<ShadowingLoop | null>(null);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycles = useRef(0);
  const epoch = useRef(0);
  const pending = useRef(false);
  const onController = useCallback((value: ShadowingController | null) => {
    controller.current = value;
    if (value && rateRef.current !== 1) { try { value.setRate(rateRef.current); } catch { setError('倍速恢复失败，请重试'); } }
  }, []);
  const onState = useCallback((value: ShadowingPlaybackState) => {
    const next = { ...value,
      currentTime: Number.isFinite(value.currentTime) ? Math.max(0, value.currentTime) : 0,
      duration: Number.isFinite(value.duration) ? Math.max(0, value.duration) : 0,
    };
    setState(previous => previous.currentTime === next.currentTime && previous.duration === next.duration
      && previous.playing === next.playing && previous.loaded === next.loaded && previous.error === next.error
      && previous.finished === next.finished ? previous : next);
  }, []);
  const cancelWait = useCallback(() => { epoch.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; pending.current = false; setWaiting(false); }, []);
  const pause = useCallback(() => { cancelWait(); try { controller.current?.pause(); } catch { setError('暂停失败，请重试'); } }, [cancelWait]);
  useFocusEffect(useCallback(() => {
    const subscription = AppState.addEventListener('change', value => { if (value !== 'active') pause(); });
    return () => { subscription.remove(); pause(); };
  }, [pause]));
  const seek = useCallback(async (time: number, play = false) => {
    cancelWait(); setError('');
    const generation = epoch.current;
    const next = Math.max(0, Math.min(state.duration || time, time));
    if (loop && (next < loop.start || next >= loop.end)) setLoop(null);
    try { await controller.current?.seek(next); if (play && generation === epoch.current) controller.current?.play(); }
    catch { setError('定位失败，请重试'); }
  }, [cancelWait, state.duration, loop]);
  const startLoop = (next: ShadowingLoop | null) => {
    pause(); cycles.current = 0; setLoop(next);
    if (next) { const generation = epoch.current; void controller.current?.seek(next.start).then(() => { if (generation === epoch.current) controller.current?.play(); }).catch(() => setError('复读定位失败，请重试')); }
  };
  useEffect(() => {
    if (!loop || pending.current || (!state.playing && !state.finished) || state.currentTime < loop.end - .035) return;
    pending.current = true;
    controller.current?.pause(); cycles.current++;
    if (repeatCount > 0 && cycles.current >= repeatCount) { setLoop(null); pending.current = false; return; }
    setWaiting(true);
    const generation = epoch.current;
    timer.current = setTimeout(() => {
      void controller.current?.seek(loop.start).then(() => {
        if (generation !== epoch.current) return;
        pending.current = false; setWaiting(false); controller.current?.play();
      }).catch(() => { pending.current = false; setWaiting(false); setError('复读失败，请重新播放'); });
    }, gap * 1000);
  }, [state.currentTime, state.playing, state.finished, loop, repeatCount, gap]);
  const toggle = async () => {
    if (state.playing || waiting) { pause(); return; }
    cancelWait(); setError('');
    const generation = epoch.current;
    try {
      if (state.finished || state.currentTime >= state.duration - .04 || (loop && state.currentTime >= loop.end)) await controller.current?.seek(loop?.start ?? 0);
      if (generation === epoch.current) controller.current?.play();
    } catch { setError('播放失败，请重试'); }
  };
  const changeRate = (value: number) => { try { controller.current?.setRate(value); rateRef.current = value; setRate(value); } catch { setError('倍速调整失败，请重试'); } };
  return { ...state, error: error || state.error, playerError: state.error, onController, onState, controller, rate, changeRate, loop, startLoop, repeatCount, setRepeatCount, gap, setGap, waiting, pause, seek, toggle, index: currentCueIndex(cues, state.currentTime) };
}
