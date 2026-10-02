import type { SpeakingPronunciationAssessmentDto, SpeakingPronunciationCapability, SpeakingPronunciationLocale, SpeakingPronunciationResult } from '@context-reader/contracts';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError } from '@/api/client';
import { getSpeakingCapabilities } from '@/api/speaking';
import { useAppTheme } from '@/context/ThemeContext';
import type { SpeakingMaterial, SpeakingRecording } from './model';
import { restoreSpeakingPronunciation, speakingPronunciationKey, submitSpeakingPronunciation } from './pronunciation';
import { speakingStorageKey } from './speakingStorage';

const scoreLabel = (score: number | null) => score === null ? '未提供分数' : `${Number(score.toFixed(1))} 分`;
const wordLabel = (score: number | null) => score === null ? '未评分' : score < 70 ? '需练习' : score < 85 ? '可改善' : '较清晰';

export function PronunciationResults({ result }: { result: SpeakingPronunciationResult }) {
  const { theme } = useAppTheme();
  const [expanded, setExpanded] = useState<number | null>(null);
  const selected = expanded === null ? undefined : result.words[expanded];
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 17 }}>句子发音分：{scoreLabel(result.score)} / 100</Text>
    <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 19 }}>逐词分数越高，发音越接近所选口音。点按单词查看音素反馈。</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {result.words.map((word, index) => <Pressable key={`${index}:${word.word}`} accessibilityRole="button"
        accessibilityLabel={`${word.word}，${scoreLabel(word.score)}，${wordLabel(word.score)}，查看音素反馈`}
        accessibilityState={{ expanded: expanded === index }} onPress={() => setExpanded(value => value === index ? null : index)}
        style={{ minHeight: 44, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 4, borderWidth: .5, borderColor: expanded === index ? theme.accent : theme.border, backgroundColor: expanded === index ? theme.accentSoft : theme.surface }}>
        <Text style={{ color: theme.text, fontSize: 14 }}>{word.word} · {scoreLabel(word.score)}</Text>
        <Text style={{ color: word.score !== null && word.score < 70 ? theme.accent : theme.textMuted, fontSize: 11, marginTop: 3 }}>{wordLabel(word.score)}</Text>
      </Pressable>)}
    </View>
    {selected ? <View style={{ gap: 7, padding: 12, borderColor: theme.border, borderWidth: .5, borderRadius: 4 }}>
      <Text style={{ color: theme.text, fontSize: 14 }}>{selected.word} 的音素反馈</Text>
      {selected.phonemes.length ? selected.phonemes.map((phoneme, index) => <View key={`${index}:${phoneme.symbol}`} style={{ gap: 3 }}>
        <Text style={{ color: theme.text, fontSize: 13 }}>目标音素 /{phoneme.symbol}/ · {scoreLabel(phoneme.score)}</Text>
        {phoneme.spokenSymbol && phoneme.spokenSymbol !== phoneme.symbol ? <Text style={{ color: theme.textSecondary, fontSize: 12 }}>识别为 /{phoneme.spokenSymbol}/，请听原音后比较口型与发音。</Text> : null}
        {phoneme.score === null ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>服务未提供这个音素的分数，不能据此判断准确度。</Text> : phoneme.score < 70 ? <Text style={{ color: theme.textSecondary, fontSize: 12 }}>先单独慢读 /{phoneme.symbol}/，再放回 {selected.word} 和整句中练习。</Text> : null}
        {phoneme.stressScore !== null ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>重音分：{scoreLabel(phoneme.stressScore)}</Text> : null}
      </View>) : <Text style={{ color: theme.textMuted, fontSize: 12 }}>服务未提供这个单词的音素分数。</Text>}
    </View> : null}
    {result.feedback.map((feedback, index) => <Text key={index} style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 20 }}>{feedback}</Text>)}
  </View>;
}

type Props = { materialId: string; material?: SpeakingMaterial; recording?: SpeakingRecording; scope: string; disabled?: boolean };
type AssessmentState = { scope: string; identity: string; busy: boolean; assessment: SpeakingPronunciationAssessmentDto | null; error: string; retryable: boolean };
export function SpeakingPronunciation({ materialId, material, recording, scope, disabled = false }: Props) {
  const { theme } = useAppTheme();
  const [locale, setLocale] = useState<SpeakingPronunciationLocale>('en-us');
  const [capabilities, setCapabilities] = useState<{ scope: string; revision: number; data: SpeakingPronunciationCapability | null; error: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [assessmentState, setAssessmentState] = useState<AssessmentState | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const working = useRef(false);
  const guest = scope.endsWith(':guest');
  const identity = recording ? speakingPronunciationKey(materialId, recording, locale) : '';
  const currentCapability = capabilities?.scope === scope && capabilities.revision === revision ? capabilities : null;
  const capability = currentCapability?.data ?? null;
  const capabilityError = currentCapability?.error ?? '';
  const checkingCapability = !guest && currentCapability === null;
  const visibleState = !disabled && assessmentState?.scope === scope && assessmentState.identity === identity ? assessmentState : null;
  const assessment = visibleState?.assessment ?? null;
  const error = visibleState?.error ?? '';
  const retryable = visibleState?.retryable ?? true;
  const busy = visibleState?.busy ?? false;
  const cancelCurrent = useCallback(() => { controller.current?.abort(); }, []);

  useEffect(() => {
    if (guest) return;
    let active = true;
    const request = new AbortController();
    void speakingStorageKey().then(async currentScope => {
      if (currentScope !== scope) throw new Error('登录状态已变化，请重新打开口语页面');
      const response = await getSpeakingCapabilities({ signal: request.signal });
      if (active) {
        const responseScope = await speakingStorageKey();
        if (!active || request.signal.aborted) return;
        if (responseScope !== scope) throw new Error('登录状态已变化，请重新打开口语页面');
        setCapabilities({ scope, revision, data: response.pronunciation ?? null, error: '' });
        if (response.pronunciation) setLocale(current => response.pronunciation!.locales.includes(current) ? current : response.pronunciation!.locales[0]);
      }
    }).catch(failure => { if (active) setCapabilities({ scope, revision, data: null, error: failure instanceof Error ? failure.message : '发音评分状态读取失败，请重试' }); });
    return () => { active = false; request.abort(); };
  }, [scope, guest, revision]);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    cancelCurrent();
    working.current = false;
    if (!recording || guest || disabled) return;
    const request = new AbortController(); controller.current = request;
    void restoreSpeakingPronunciation({ materialId, material, scope, recording, locale, signal: request.signal })
      .then(async cached => {
        const responseScope = await speakingStorageKey();
        if (generation.current === requestGeneration && !request.signal.aborted && responseScope === scope) setAssessmentState({ scope, identity, busy: false, assessment: cached, error: '', retryable: true });
      })
      .catch(failure => {
        if (generation.current === requestGeneration && !request.signal.aborted) {
          setAssessmentState({ scope, identity, busy: false, assessment: null, error: failure instanceof Error ? failure.message : '历史评分读取失败，请重试', retryable: !(failure instanceof ApiError) || failure.retryable });
        }
      });
    return () => { request.abort(); cancelCurrent(); };
    // The identity contains every recording snapshot field. Ordinary material refreshes do not cancel scoring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, identity, guest, disabled, cancelCurrent]);

  const score = async (restoreOnly = false) => {
    if (!recording || (!restoreOnly && !capability?.available) || disabled || working.current) return;
    const requestGeneration = ++generation.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    working.current = true; setAssessmentState({ scope, identity, busy: true, assessment, error: '', retryable: true });
    try {
      const context = { materialId, material, scope, recording, locale, signal: request.signal };
      const response = restoreOnly ? await restoreSpeakingPronunciation(context) : await submitSpeakingPronunciation({ ...context, capability: capability! });
      const responseScope = await speakingStorageKey();
      if (generation.current === requestGeneration && !request.signal.aborted && responseScope === scope) setAssessmentState({ scope, identity, busy: false, assessment: response, error: '', retryable: true });
    } catch (failure) {
      if (generation.current === requestGeneration && !request.signal.aborted) {
        setAssessmentState({ scope, identity, busy: false, assessment, error: failure instanceof Error ? failure.message : '发音评分失败，请重试', retryable: !(failure instanceof ApiError) || failure.retryable });
      }
    } finally {
      if (generation.current === requestGeneration && !request.signal.aborted) {
        working.current = false;
        setAssessmentState(current => current?.scope === scope && current.identity === identity ? { ...current, busy: false } : current);
      }
    }
  };
  const snapshotMissing = recording && !recording.referenceText;
  const longRecording = recording && recording.durationMs > Math.min(capability?.maxDurationMs ?? 30_000, 30_000);
  const incompleteSnapshot = recording && material?.storage === 'cloud' && !recording.subtitleRevision;
  const snapshotTooLong = recording && (recording.referenceText?.length ?? 0) > 1_000;
  const invalid = snapshotMissing || longRecording || incompleteSnapshot || snapshotTooLong || recording?.cloudPending;
  const ready = !disabled && assessment?.status === 'ready' && assessment.result;
  const failed = !disabled && assessment?.status === 'failed' ? assessment.error : null;
  const processing = !disabled && assessment?.status === 'processing';
  return <ScrollView accessibilityLabel="发音评分面板" nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 300, flexGrow: 0 }} contentContainerStyle={{ gap: 10, borderTopColor: theme.border, borderTopWidth: .5, paddingTop: 12, paddingBottom: 6 }}>
    <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 14 }}>AI 发音评分</Text>
    {guest ? <><Text style={{ color: theme.textMuted, fontSize: 12 }}>登录后可获取句子、单词和音素的发音分数。</Text><Pressable accessibilityRole="button" onPress={() => router.push('/login')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent }}>登录使用发音评分</Text></Pressable></> : <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['en-us', 'en-gb'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === 'en-us' ? '美式发音' : '英式发音'}
          accessibilityState={{ checked: locale === value, disabled: Boolean(capability && !capability.locales.includes(value)) }}
          disabled={Boolean(capability && !capability.locales.includes(value))} onPress={() => setLocale(value)}
          style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: .5, borderRadius: 4, borderColor: locale === value ? theme.accent : theme.border }}>
          <Text style={{ color: locale === value ? theme.accent : theme.textMuted }}>{value === 'en-us' ? '美式' : '英式'}</Text>
        </Pressable>)}
      </View>
      {recording?.referenceText && !disabled ? <Text style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 20 }}>录音目标：{recording.referenceText}</Text> : null}
      <Text style={{ color: theme.textMuted, fontSize: 11, lineHeight: 18 }}>每次评测一条英文字幕，录音需在 30 秒以内。点击发音评分后才会进行评测。</Text>
      {checkingCapability ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>正在检查评分服务…</Text> : capabilityError ? <><Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{capabilityError}</Text><Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent }}>重试读取评分服务</Text></Pressable></> : !capability?.available ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>发音评分暂未开放，录音仍可保存和回放。</Text> : null}
      {snapshotMissing ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>这条录音没有保存目标字幕，请重新录制后评分。</Text> : longRecording ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>录音超过 30 秒，请选择一句短字幕重新录制。</Text> : incompleteSnapshot || snapshotTooLong ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>录音的目标字幕无效或过长，请选择短句重新录制。</Text> : recording?.cloudPending ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>请先完成录音云端保存，再进行评分。</Text> : !recording ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>先录下一句自己的声音，再进行发音评分。</Text> : null}
      {capability?.available && recording && !invalid && !ready && !processing && (!failed || failed.retryable) && (!error || retryable) ? <Pressable accessibilityRole="button" accessibilityLabel={error || failed ? '重试发音评分' : '发音评分'} accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={() => void score()}
        style={{ minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{busy ? <ActivityIndicator color={theme.accent} /> : null}<Text style={{ color: theme.accent }}>{busy ? '正在上传并评分…' : error || failed ? '重试发音评分' : '发音评分'}</Text></View></Pressable> : null}
      {processing ? <><Text style={{ color: theme.textMuted, fontSize: 12 }}>评分正在处理中，可稍后查看结果。</Text><Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => void score(true)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent }}>{busy ? '正在读取评分…' : '查看评分进度'}</Text></Pressable></> : null}
      {failed ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{failed.message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{error}</Text> : null}
      {ready ? <PronunciationResults key={assessment?.id} result={ready} /> : null}
    </>}
  </ScrollView>;
}
