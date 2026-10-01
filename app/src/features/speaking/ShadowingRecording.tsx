import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { persistSpeakingMedia } from './mediaStorage';
import { formatSpeakingTime, type SpeakingMaterial, type SpeakingStore } from './model';
import { updateSpeakingStore } from './speakingStorage';
import { resolveSpeakingRecording, saveSpeakingCloudRecording } from './cloudSync';

type Props = { materialId: string; material?: SpeakingMaterial; cueId: string; scope: string; saved?: SpeakingStore['recordings'][string]; pauseOriginal: () => void; onActive: (active: boolean) => void; onSaved: (store: SpeakingStore) => void };
export function ShadowingRecording({ materialId, material, cueId, scope, saved, pauseOriginal, onActive, onSaved }: Props) {
  const { theme } = useAppTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 100);
  const replay = useAudioPlayer(null);
  const replayStatus = useAudioPlayerStatus(replay);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedRecording, setLoadedRecording] = useState('');
  const [mediaRevision, setMediaRevision] = useState(0);
  const ready = Boolean(saved && loadedRecording === saved.mediaId);
  const recordingStarted = useRef(0);
  const active = useRef(true);
  const [pendingRecording, setPendingRecording] = useState<{ mediaId: string; durationMs: number; cueId: string } | null>(null);
  const pending = pendingRecording ?? (saved?.cloudPending ? saved : null);
  useEffect(() => { onActive(recording.isRecording || replayStatus.playing); }, [recording.isRecording, replayStatus.playing, onActive]);
  useEffect(() => {
    let mounted = true;
    let release: (() => void) | undefined;
    if (saved) void resolveSpeakingRecording(saved).then(media => {
      if (!mounted) { media.release(); return; }
      release = media.release; replay.replace(media.uri); setLoadedRecording(saved.mediaId);
    }).catch(() => { if (mounted) setError('录音读取失败，请重试或重新录制'); });
    return () => { mounted = false; release?.(); };
  }, [saved, replay, mediaRevision]);
  const stop = useCallback(async () => {
    if (!recordingStarted.current) return;
    const durationMs = Date.now() - recordingStarted.current;
    recordingStarted.current = 0;
    setBusy(true);
    let localSaved = false;
    try {
      try { await recorder.stop(); }
      finally { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); }
      if (!recorder.uri) throw new Error('录音没有生成，请重新录制');
      const mediaId = await persistSpeakingMedia({ name: Platform.OS === 'web' ? 'shadowing.webm' : 'shadowing.m4a', uri: recorder.uri, lastModified: Date.now() });
      localSaved = true;
      const result = { mediaId, durationMs, cueId, ...(material?.storage === 'cloud' ? { cloudPending: true } : {}) };
      if (active.current) setPendingRecording(result);
      const localStore = await updateSpeakingStore(current => { current.recordings[materialId] = result; }, scope);
      if (material?.storage === 'cloud' && active.current) onSaved(localStore);
      const store = material?.storage === 'cloud' ? await saveSpeakingCloudRecording(material, scope, result) : localStore;
      if (active.current) setPendingRecording(null);
      onSaved(store);
      if (active.current) setError('');
    } catch { if (active.current) setError(material?.storage === 'cloud' && localSaved ? '录音已保留在本机，尚未同步到云端，请重试保存' : '录音保存失败，请重试；请确认麦克风可用且存储空间充足'); }
    finally { if (active.current) setBusy(false); }
  }, [recorder, cueId, materialId, material, scope, onSaved]);
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') { replay.pause(); void stopRef.current(); } });
    return () => { active.current = false; replay.pause(); void stopRef.current(); subscription.remove(); };
  }, [replay]));
  const start = async () => {
    if (busy) return;
    pauseOriginal(); replay.pause(); setError(''); setBusy(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) { setError('未获得麦克风权限，请在系统设置中允许录音'); return; }
      if (!active.current) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await recorder.prepareToRecordAsync();
      if (!active.current) { await setAudioModeAsync({ allowsRecording: false }); return; }
      recordingStarted.current = Date.now(); recorder.record();
    } catch {
      recordingStarted.current = 0;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      if (active.current) setError('无法开始录音，请检查麦克风权限后重试');
    }
    finally { if (active.current) setBusy(false); }
  };
  const retry = async () => {
    if (!pending || busy) return;
    const result = pending;
    setBusy(true);
    try { onSaved(material?.storage === 'cloud' ? await saveSpeakingCloudRecording(material, scope, result) : await updateSpeakingStore(current => { current.recordings[materialId] = result; }, scope)); setPendingRecording(null); setError(''); }
    catch { setError('录音仍未保存，请检查剩余空间后重试'); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 10, padding: 18, borderTopWidth: .5, borderTopColor: theme.border }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><Pressable accessibilityRole="button" accessibilityLabel={recording.isRecording ? '停止录音' : saved ? '重新录音' : '开始录音'} disabled={busy} onPress={() => void (recording.isRecording ? stop() : start())} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: recording.isRecording ? theme.danger : theme.accent, fontSize: 14 }}>{busy ? '正在保存…' : recording.isRecording ? `停止录音 ${formatSpeakingTime(recording.durationMillis / 1000)}` : saved ? '重新录音' : '录下自己的声音'}</Text></Pressable><Pressable disabled={!ready || recording.isRecording || busy} accessibilityRole="button" accessibilityLabel={replayStatus.playing ? '暂停录音回放' : '回放录音'} accessibilityState={{ disabled: !ready || recording.isRecording || busy }} onPress={() => { pauseOriginal(); if (replayStatus.playing) replay.pause(); else { void replay.seekTo(0).then(() => replay.play()).catch(() => setError('录音回放失败，请重试')); } }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: ready ? theme.accent : theme.textMuted }}>{replayStatus.playing ? '暂停回放' : '回放录音'}</Text></Pressable></View>
    <Text style={{ color: theme.textMuted, fontSize: 10, lineHeight: 18 }}>{material?.storage === 'cloud' ? '录音同步到账号，方便在其他设备回放。' : '录音保存在当前设备。'}用自己的耳朵比较节奏与发音。当前不做 AI 发音评分。</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{error}</Text> : null}{pending ? <Pressable accessibilityRole="button" onPress={() => void retry()} style={{ minHeight: 44 }}><Text style={{ color: theme.accent }}>重试保存录音</Text></Pressable> : null}
    {saved && !pending && error ? <Pressable accessibilityRole="button" onPress={() => { setError(''); setMediaRevision(value => value + 1); }} style={{ minHeight: 44 }}><Text style={{ color: theme.accent }}>重新读取录音</Text></Pressable> : null}
  </View>;
}
