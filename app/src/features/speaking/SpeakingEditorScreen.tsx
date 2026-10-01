import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { formatSpeakingTime, speakingId, type SpeakingCue, type SpeakingMaterial } from './model';
import { parseSubtitleTime, validateSpeakingCues } from './subtitles';
import { saveSpeakingMaterialSubtitles } from './cloudSync';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingButton, SpeakingHeader, SpeakingStatus, speakingStyles } from './SpeakingComponents';

type DraftCue = { id: string; start: string; end: string; en: string; zh: string };
const preciseTime = (seconds: number) => {
  const milliseconds = Math.round(seconds * 1000);
  const wholeSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(wholeSeconds / 3600);
  const clock = `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${formatSpeakingTime(wholeSeconds % 3600)}`;
  return `${clock}.${String(milliseconds % 1000).padStart(3, '0')}`;
};
export function SpeakingEditorScreen() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const library = useSpeakingLibrary(id);
  const material = library.materials.find(item => item.id === id);
  if (library.loading || library.error || !material) return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="校正字幕" /><View style={speakingStyles.content}><SpeakingStatus loading={library.loading} error={library.error} retry={library.refresh} />{!library.loading && !library.error && !material ? <Text style={{ color: theme.danger }}>文件不存在，请返回文件页。</Text> : null}</View></View>;
  return <SpeakingEditorForm key={`${library.scope}:${id}`} material={material} library={library} />;
}
function SpeakingEditorForm({ material, library }: { material: SpeakingMaterial; library: ReturnType<typeof useSpeakingLibrary> }) {
  const { theme } = useAppTheme();
  const id = material.id;
  const [drafts, setDrafts] = useState<DraftCue[]>(() => material.cues.map(cue => ({ ...cue, start: preciseTime(cue.start), end: preciseTime(cue.end) })));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [jump, setJump] = useState('');
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(drafts.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const edit = (cueId: string, field: keyof DraftCue, value: string) => setDrafts(current => current.map(cue => cue.id === cueId ? { ...cue, [field]: value } : cue));
  const save = async () => {
    if (!material || saving) return;
    setError('');
    try {
      const cues: SpeakingCue[] = drafts.map(cue => ({ ...cue, start: parseSubtitleTime(cue.start), end: parseSubtitleTime(cue.end), en: cue.en.trim() }));
      validateSpeakingCues(cues, material.duration);
      setSaving(true);
      if (!library.scope) throw new Error('文件库仍在加载，请稍后重试');
      await saveSpeakingMaterialSubtitles(material, library.scope, cues);
      router.replace({ pathname: '/speaking/shadowing', params: { id } });
    } catch (failure) { setError(failure instanceof Error ? failure.message : '字幕保存失败，请重试'); }
    finally { setSaving(false); }
  };
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="校正字幕" /><ScrollView contentContainerStyle={speakingStyles.content} keyboardShouldPersistTaps="handled">
    <Text style={[speakingStyles.heading, { color: theme.text }]}>{material?.title ?? '字幕校正'}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>校正英文、中文与时间范围。时间使用 00:00.000，超过一小时使用 01:00:00.000，按开始时间排序；不同说话者可以重叠。{material.storage === 'cloud' ? '保存后同步到账号。' : '保存到当前设备。'}</Text><SpeakingStatus loading={library.loading} error={library.error} retry={library.refresh} />
    <Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 18 }]}>共 {drafts.length} 句 · 第 {visiblePage + 1}／{pageCount} 页 · 每页 20 句</Text>
    {pageCount > 1 ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><TextInput accessibilityLabel="跳转字幕句号" value={jump} onChangeText={setJump} keyboardType="number-pad" placeholder="输入句号" placeholderTextColor={theme.textMuted} style={[speakingStyles.input, { flex: 1, color: theme.text, borderColor: theme.border }]} /><Pressable accessibilityRole="button" disabled={saving} onPress={() => { const value = Number(jump); if (Number.isInteger(value) && value >= 1 && value <= drafts.length) { setPage(Math.floor((value - 1) / pageSize)); setError(''); } else setError('请输入有效的字幕句号'); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent }}>跳转</Text></Pressable></View> : null}
    {!library.loading && !material ? <Text style={{ color: theme.danger }}>文件不存在，请返回文件页。</Text> : null}
    {drafts.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize).map((cue, offset) => { const index = visiblePage * pageSize + offset; return <View key={cue.id} style={{ paddingVertical: 22, gap: 10, borderBottomColor: theme.border, borderBottomWidth: .5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ color: theme.accent, fontSize: 12 }}>第 {index + 1} 句</Text><Pressable accessibilityRole="button" accessibilityLabel={`删除第 ${index + 1} 句`} disabled={saving} onPress={() => setDrafts(current => current.filter(item => item.id !== cue.id))} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.textMuted }}>移除</Text></Pressable></View>
      <View style={{ flexDirection: 'row', gap: 12 }}>{(['start', 'end'] as const).map(field => <View key={field} style={{ flex: 1 }}><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{field === 'start' ? '开始' : '结束'}</Text><TextInput accessibilityLabel={`第 ${index + 1} 句${field === 'start' ? '开始' : '结束'}时间`} value={cue[field]} onChangeText={value => edit(cue.id, field, value)} editable={!saving} style={[speakingStyles.input, { borderColor: theme.border, color: theme.text }]} /></View>)}</View>
      <TextInput multiline maxLength={4_000} accessibilityLabel={`第 ${index + 1} 句英文`} value={cue.en} onChangeText={value => edit(cue.id, 'en', value)} editable={!saving} style={[speakingStyles.input, { borderColor: theme.border, color: theme.text, minHeight: 78, textAlignVertical: 'top' }]} placeholder="英文字幕" placeholderTextColor={theme.textMuted} />
      <TextInput multiline maxLength={4_000} accessibilityLabel={`第 ${index + 1} 句中文`} value={cue.zh} onChangeText={value => edit(cue.id, 'zh', value)} editable={!saving} style={[speakingStyles.input, { borderColor: theme.border, color: theme.textSecondary }]} placeholder="中文译文（选填）" placeholderTextColor={theme.textMuted} />
    </View>; })}
    {pageCount > 1 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 }}><Pressable accessibilityRole="button" disabled={saving || visiblePage === 0} onPress={() => setPage(visiblePage - 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: visiblePage === 0 ? theme.textMuted : theme.accent }}>← 上一页</Text></Pressable><Pressable accessibilityRole="button" disabled={saving || visiblePage + 1 >= pageCount} onPress={() => setPage(visiblePage + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: visiblePage + 1 >= pageCount ? theme.textMuted : theme.accent }}>下一页 →</Text></Pressable></View> : null}
    <Pressable accessibilityRole="button" disabled={saving || !material} onPress={() => { const previous = drafts.at(-1); let start = 0; try { if (previous) start = parseSubtitleTime(previous.end); } catch { setError('请先修正上一句的结束时间'); return; } setPage(Math.floor(drafts.length / pageSize)); setDrafts(current => [...current, { id: speakingId(), start: preciseTime(start), end: preciseTime(start + 5), en: '', zh: '' }]); }} style={{ minHeight: 52, justifyContent: 'center' }}><Text style={{ color: theme.accent }}>＋ 添加一句字幕</Text></Pressable>
    {error ? <Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{error}</Text> : null}<SpeakingButton label={saving ? '正在保存…' : '保存并开始跟读'} disabled={saving || Boolean(library.error)} onPress={() => void save()} />
  </ScrollView></View>;
}
