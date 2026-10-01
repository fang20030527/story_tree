import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { speakingId, type SpeakingMaterial } from './model';
import { updateSpeakingStore } from './speakingStorage';
import { syncSpeakingSession } from './cloudSync';

export function useSpeakingSession(material: SpeakingMaterial, scope: string, enabled: boolean, position: number, cueIndex: number) {
  const session = useRef({ id: speakingId(), date: new Date().toISOString(), elapsedMs: 0, started: 0, visited: new Set<string>() });
  const positionRef = useRef(position);
  const saveError = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => { positionRef.current = position; }, [position]);
  const flush = useCallback(() => {
    if (session.current.started) {
      session.current.elapsedMs += Math.max(0, Date.now() - session.current.started);
      session.current.started = 0;
    }
  }, []);
  useEffect(() => {
    if (enabled) { session.current.started ||= Date.now(); const cue = material.cues[cueIndex]; if (cue) session.current.visited.add(cue.id); }
    else flush();
  }, [enabled, cueIndex, material.cues, flush]);
  const save = useCallback(async () => {
    const running = Boolean(session.current.started); flush();
    if (running) session.current.started = Date.now();
    const snapshot = { ...session.current, visited: new Set(session.current.visited) };
    if (snapshot.elapsedMs < 250) return null;
    try {
      const store = await updateSpeakingStore(current => {
        current.positions[material.id] = positionRef.current;
        const value = { id: snapshot.id, materialId: material.id, title: material.title, date: snapshot.date, elapsedMs: snapshot.elapsedMs, cueCount: snapshot.visited.size,
          ...(material.storage === 'cloud' ? { cloudPending: true, position: positionRef.current } : {}) };
        current.history = [value, ...current.history.filter(item => item.id !== snapshot.id)];
      }, scope);
      const synced = material.storage === 'cloud' ? await syncSpeakingSession(material, scope, snapshot.id, {
        materialId: material.id, date: snapshot.date, elapsedMs: Math.round(snapshot.elapsedMs), cueCount: snapshot.visited.size, position: positionRef.current,
      }) : store;
      saveError.current = false; setError(''); return synced;
    } catch { saveError.current = true; const message = material.storage === 'cloud' ? '练习记录尚未同步到云端，请重试保存' : '练习记录保存失败，请重试'; setError(message); throw new Error(message); }
  }, [material, scope, flush]);
  useEffect(() => {
    if (!enabled) { void Promise.resolve().then(save).catch(() => undefined); return; }
    const timer = setInterval(() => { void save().catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [enabled, save]);
  useFocusEffect(useCallback(() => () => { flush(); void save().catch(() => undefined); }, [save, flush]));
  return { save, saveError, error };
}
