import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { persistSpeakingMedia } from './mediaStorage';
import { formatSpeakingTime, type SpeakingMaterial, type SpeakingRecording, type SpeakingStore } from './model';
import { updateSpeakingStore } from './speakingStorage';
import { resolveSpeakingRecording, saveSpeakingCloudRecording } from './cloudSync';
import { SpeakingPronunciation } from './SpeakingPronunciation';

type Props = { materialId: string; material?: SpeakingMaterial; cueId: string; scope: string; saved?: SpeakingRecording; pauseOriginal: () => void; onActive: (active: boolean) => void; onSaved: (store: SpeakingStore) => void };
type RecordingContext = { materialId: string; material?: SpeakingMaterial; cueId: string; scope: string; referenceText?: string; subtitleRevision?: number };
type PendingRecording = { recording: SpeakingRecording; context: RecordingContext };
// 离开练习页时 useAudioPlayer 已先释放回放播放器，随后的失焦清理再调用 pause 会抛出
// “Unable to find the native shared object”，在正式包里属于未捕获错误，会直接闪退。
function pauseReplay(player: ReturnType<typeof useAudioPlayer>) { try { player.pause(); } catch { /* 播放器已被释放。 */ } }
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
  const playbackId = JSON.stringify([scope, materialId, saved?.mediaId]);
  const ready = Boolean(saved && loadedRecording === playbackId);
  const recordingStarted = useRef(0);
  const recordingContext = useRef<RecordingContext | null>(null);
  const active = useRef(true);
  const operationBusy = useRef(false);
  const current = useRef({ scope, materialId, onSaved });
  useLayoutEffect(() => { current.current = { scope, materialId, onSaved }; }, [scope, materialId, onSaved]);
  const [pendingRecording, setPendingRecording] = useState<PendingRecording | null>(null);
  const pending = pendingRecording?.context.scope === scope && pendingRecording.context.materialId === materialId
    ? pendingRecording : saved?.cloudPending ? { recording: saved, context: { materialId, material, cueId: saved.cueId, scope } } : null;
  const canDisplay = useCallback((context: RecordingContext) => active.current && current.current.scope === context.scope && current.current.materialId === context.materialId, []);
  useEffect(() => { onActive(recording.isRecording || replayStatus.playing); }, [recording.isRecording, replayStatus.playing, onActive]);
  useEffect(() => {
    let mounted = true;
    let release: (() => void) | undefined;
    if (saved) void resolveSpeakingRecording(saved).then(media => {
      if (!mounted) { media.release(); return; }
      release = media.release; replay.replace(media.uri); setLoadedRecording(JSON.stringify([scope, materialId, saved.mediaId]));
    }).catch(() => { if (mounted) setError('录音读取失败，请重试或重新录制'); });
    return () => { mounted = false; release?.(); };
  }, [saved, replay, mediaRevision, scope, materialId]);
  const stop = useCallback(async () => {
    const context = recordingContext.current;
    if (!recordingStarted.current || !context) return;
    const durationMs = Math.max(1, Date.now() - recordingStarted.current);
    recordingStarted.current = 0;
    recordingContext.current = null;
    operationBusy.current = true;
    if (canDisplay(context)) setBusy(true);
    let localSaved = false;
    try {
      try { await recorder.stop(); }
      finally { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); }
      if (!recorder.uri) throw new Error('录音没有生成，请重新录制');
      const mediaId = await persistSpeakingMedia({ name: Platform.OS === 'web' ? 'shadowing.webm' : 'shadowing.m4a', uri: recorder.uri, lastModified: Date.now() });
      localSaved = true;
      const result: SpeakingRecording = {
        mediaId, durationMs, cueId: context.cueId,
        ...(context.referenceText ? { referenceText: context.referenceText } : {}),
        ...(context.subtitleRevision ? { subtitleRevision: context.subtitleRevision } : {}),
        ...(context.material?.storage === 'cloud' ? { cloudPending: true } : {}),
      };
      if (canDisplay(context)) setPendingRecording({ recording: result, context });
      const localStore = await updateSpeakingStore(store => { store.recordings[context.materialId] = result; }, context.scope);
      if (context.material?.storage === 'cloud' && canDisplay(context)) current.current.onSaved(localStore);
      const store = context.material?.storage === 'cloud' ? await saveSpeakingCloudRecording(context.material, context.scope, result) : localStore;
      if (canDisplay(context)) { setPendingRecording(null); current.current.onSaved(store); setError(''); }
    } catch { if (canDisplay(context)) setError(context.material?.storage === 'cloud' && localSaved ? '录音已保留在本机，尚未同步到云端，请重试保存' : '录音保存失败，请重试；请确认麦克风可用且存储空间充足'); }
    finally { operationBusy.current = false; if (active.current) setBusy(false); }
  }, [recorder, canDisplay]);
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    setError(''); setPendingRecording(value => value?.context.scope === scope && value.context.materialId === materialId ? value : null);
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') { pauseReplay(replay); void stopRef.current(); } });
    return () => { active.current = false; subscription.remove(); pauseReplay(replay); void stopRef.current(); };
  }, [replay, scope, materialId]));
  const start = async () => {
    if (operationBusy.current) return;
    const referenceText = material?.cues.find(cue => cue.id === cueId)?.en.trim();
    const context: RecordingContext = {
      materialId, material, scope, cueId,
      ...(referenceText ? { referenceText } : {}), ...(material?.revision ? { subtitleRevision: material.revision } : {}),
    };
    pauseOriginal(); replay.pause(); setError(''); setBusy(true); operationBusy.current = true;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) { if (canDisplay(context)) setError('未获得麦克风权限，请在系统设置中允许录音'); return; }
      if (!canDisplay(context)) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await recorder.prepareToRecordAsync();
      if (!canDisplay(context)) { await setAudioModeAsync({ allowsRecording: false }); return; }
      recordingContext.current = context;
      recordingStarted.current = Date.now(); recorder.record();
    } catch {
      recordingContext.current = null; recordingStarted.current = 0;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      if (canDisplay(context)) setError('无法开始录音，请检查麦克风权限后重试');
    }
    finally { operationBusy.current = false; if (active.current) setBusy(false); }
  };
  const retry = async () => {
    if (!pending || operationBusy.current) return;
    const { context, recording: result } = pending;
    operationBusy.current = true; setBusy(true);
    try {
      const store = context.material?.storage === 'cloud' ? await saveSpeakingCloudRecording(context.material, context.scope, result)
        : await updateSpeakingStore(current => { current.recordings[context.materialId] = result; }, context.scope);
      if (canDisplay(context)) { current.current.onSaved(store); setPendingRecording(null); setError(''); }
    } catch { if (canDisplay(context)) setError('录音仍未保存，请检查网络和剩余空间后重试'); }
    finally { operationBusy.current = false; if (active.current) setBusy(false); }
  };
  return <View style={{ gap: 8, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><Pressable accessibilityRole="button" accessibilityLabel={recording.isRecording ? '停止录音' : saved ? '重新录音' : '开始录音'} disabled={busy} onPress={() => void (recording.isRecording ? stop() : start())} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: recording.isRecording ? theme.danger : theme.accent, fontSize: 15, fontWeight: '600' }}>{busy ? '正在保存…' : recording.isRecording ? `停止录音 ${formatSpeakingTime(recording.durationMillis / 1000)}` : saved ? '重新录音' : '录下自己的声音'}</Text></Pressable><Pressable disabled={!ready || recording.isRecording || busy} accessibilityRole="button" accessibilityLabel={replayStatus.playing ? '暂停录音回放' : '回放录音'} accessibilityState={{ disabled: !ready || recording.isRecording || busy }} onPress={() => { pauseOriginal(); if (replayStatus.playing) replay.pause(); else { void replay.seekTo(0).then(() => replay.play()).catch(() => setError('录音回放失败，请重试')); } }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: ready ? theme.accent : theme.textMuted }}>{replayStatus.playing ? '暂停回放' : '回放录音'}</Text></Pressable></View>
    <Text style={{ color: theme.textMuted, fontSize: 11, lineHeight: 18 }}>{material?.storage === 'cloud' ? '录音同步到账号，方便在其他设备回放。' : '录音保存在当前设备。'}用自己的耳朵比较节奏与发音。</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{error}</Text> : null}{pending ? <Pressable accessibilityRole="button" onPress={() => void retry()} style={{ minHeight: 44 }}><Text style={{ color: theme.accent }}>重试保存录音</Text></Pressable> : null}
    {saved && !pending && error ? <Pressable accessibilityRole="button" onPress={() => { setError(''); setMediaRevision(value => value + 1); }} style={{ minHeight: 44 }}><Text style={{ color: theme.accent }}>重新读取录音</Text></Pressable> : null}
    <SpeakingPronunciation materialId={materialId} material={material} scope={scope} recording={pending?.recording ?? saved} disabled={busy || recording.isRecording} />
  </View>;
}
