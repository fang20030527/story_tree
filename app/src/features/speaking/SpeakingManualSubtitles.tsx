import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingId, type SpeakingCue } from './model';
import { parseSubtitleTime, validateSpeakingCues } from './subtitles';
import { speakingStyles } from './SpeakingComponents';

export function SpeakingManualSubtitles({ cues, onChange, disabled }: {
  cues: SpeakingCue[]; onChange: (cues: SpeakingCue[]) => void; disabled: boolean;
}) {
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('00:00.000');
  const [end, setEnd] = useState('00:05.000');
  const [english, setEnglish] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    try {
      const next = [...cues, { id: speakingId(), start: parseSubtitleTime(start), end: parseSubtitleTime(end), en: english.trim(), zh: '' }]
        .sort((a, b) => a.start - b.start);
      validateSpeakingCues(next);
      onChange(next); setEnglish(''); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '请检查字幕内容与时间'); }
  };
  return <View style={{ marginBottom: 14, gap: 10 }}>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => setOpen(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: theme.accent }}>{open ? '收起手动字幕' : '手动添加字幕'}</Text>
    </Pressable>
    {open ? <>
      <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>填写这一句的时间与英文，保存后可逐句校正。中文译文可稍后补充。</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>{([{ label: '开始', value: start, set: setStart }, { label: '结束', value: end, set: setEnd }]).map(field =>
        <View key={field.label} style={{ flex: 1, gap: 6 }}><Text style={{ color: theme.textMuted }}>{field.label}时间</Text>
          <TextInput accessibilityLabel={`手动字幕${field.label}时间`} value={field.value} onChangeText={field.set} editable={!disabled}
            style={[speakingStyles.input, { color: theme.text, borderColor: theme.border }]} /></View>)}</View>
      <TextInput accessibilityLabel="手动字幕英文" placeholder="输入这一句英文" placeholderTextColor={theme.textMuted} value={english}
        onChangeText={setEnglish} maxLength={4_000} multiline editable={!disabled} style={[speakingStyles.input, { color: theme.text, borderColor: theme.border, minHeight: 80 }]} />
      <Pressable accessibilityRole="button" disabled={disabled} onPress={add} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent }}>＋ 加入这句字幕</Text></Pressable>
      {error ? <Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{error}</Text> : null}
    </> : null}
  </View>;
}
