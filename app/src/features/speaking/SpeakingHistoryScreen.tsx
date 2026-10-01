import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingHeader, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { syncSpeakingSession } from './cloudSync';
import type { SpeakingSession } from './model';

export function SpeakingHistoryScreen() {
  const { theme } = useAppTheme();
  const library = useSpeakingLibrary();
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const retry = async (session: SpeakingSession) => {
    const material = library.materials.find(item => item.id === session.materialId);
    if (!library.scope || material?.storage !== 'cloud' || saving) return;
    setSaving(session.id); setError('');
    try { library.accept(await syncSpeakingSession(material, library.scope, session.id, { materialId: session.materialId, date: session.date, elapsedMs: Math.round(session.elapsedMs), cueCount: session.cueCount, position: session.position ?? library.store.positions[session.materialId] ?? 0 })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '云端同步失败，请重试'); }
    finally { setSaving(''); }
  };
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="跟读记录" /><ScrollView contentContainerStyle={speakingStyles.content}>
    <Text style={[speakingStyles.heading, { color: theme.text }]}>每一次开口，都留下积累。</Text><SpeakingStatus loading={library.loading} error={library.error} retry={library.refresh} />
    {!library.loading && !library.error && !library.store.history.length ? <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>还没有练习记录。完成一次跟读后，记录会保存在这里。</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
    {library.store.history.map(session => <View key={session.id} style={{ paddingVertical: 24, borderBottomWidth: .5, borderBottomColor: theme.border, gap: 10 }}><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/speaking/shadowing', params: { id: session.materialId } })} style={{ gap: 10 }}><Text style={{ color: theme.text, fontSize: 18 }}>{session.title}</Text><Text style={{ color: theme.textMuted, fontSize: 12 }}>{new Date(session.date).toLocaleString('zh-CN')} · {session.cueCount} 句 · {(session.elapsedMs / 60000).toFixed(1)} 分钟{session.cloudPending ? ' · 等待同步' : ''}</Text><Text style={{ color: theme.accent, fontSize: 12 }}>继续跟读 →</Text></Pressable>{session.cloudPending && library.cloud ? <Pressable accessibilityRole="button" disabled={Boolean(saving)} onPress={() => void retry(session)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.accent }}>{saving === session.id ? '正在同步…' : '重试同步这次练习'}</Text></Pressable> : null}</View>)}
  </ScrollView></View>;
}
