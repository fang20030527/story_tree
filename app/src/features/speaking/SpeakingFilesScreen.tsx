import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BrandHeader, PageHeading } from '@/components/brand';
import { useAppTheme } from '@/context/ThemeContext';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { SpeakingButton, SpeakingMaterialRow, SpeakingStatus, speakingStyles } from './SpeakingComponents';

export function SpeakingFilesScreen() {
  const { theme } = useAppTheme();
  const library = useSpeakingLibrary();
  const [filter, setFilter] = useState('全部');
  const recent = library.store.history.find(session => library.materials.some(item => item.id === session.materialId && item.origin === 'file'));
  const continuation = library.materials.find(item => item.id === recent?.materialId);
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><BrandHeader action="add-outline" label="导入跟读文件" onPress={() => router.push('/speaking/import')} /><ScrollView contentContainerStyle={speakingStyles.content}>
    <PageHeading title="文件" description="把想练的声音，留在这里。" />
    {continuation ? <View style={{ padding: 20, backgroundColor: theme.accentSoft, marginBottom: 24 }}><Text style={{ color: theme.accent, fontSize: 12 }}>继续跟读</Text><SpeakingMaterialRow material={continuation} position={library.store.positions[continuation.id]} onPress={() => router.push({ pathname: '/speaking/shadowing', params: { id: continuation.id } })} /></View> : null}
    <SpeakingButton label="导入音频或视频" onPress={() => router.push('/speaking/import')} />
    <View style={speakingStyles.chips}>{['全部', '音频', '视频'].map(label => <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: filter === label }} onPress={() => setFilter(label)} style={[speakingStyles.chip, { borderColor: filter === label ? theme.text : theme.border, backgroundColor: filter === label ? theme.text : 'transparent' }]}><Text style={{ color: filter === label ? theme.bg : theme.textSecondary }}>{label}</Text></Pressable>)}</View>
    <SpeakingStatus loading={library.loading} error={library.error} retry={library.refresh} />
    {!library.loading && !library.error && !library.store.files.length ? <View style={{ paddingVertical: 40, gap: 14 }}><Text style={{ color: theme.text, fontSize: 20 }}>这里，等着你的第一段声音。</Text><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>添加音频或视频，导入字幕，再逐句跟读。</Text></View> : null}
    {library.materials.filter(item => item.origin === 'file' && (filter === '全部' || (filter === '音频' ? item.mediaType === 'audio' : item.mediaType === 'video'))).map(item => <SpeakingMaterialRow key={item.id} material={item} position={library.store.positions[item.id]} onPress={() => router.push({ pathname: (item.cueCount ?? item.cues.length) ? '/speaking/shadowing' : '/speaking/edit', params: { id: item.id } })} />)}
    {library.moreError ? <Text accessibilityRole="alert" style={[speakingStyles.error, { color: theme.danger }]}>{library.moreError}</Text> : null}
    {library.hasMore ? <SpeakingButton label={library.loadingMore ? '正在读取…' : library.moreError ? '重试读取更多文件' : '加载更多文件'} disabled={library.loadingMore || library.loading} onPress={() => void library.loadMore()} /> : null}
    <Text style={[speakingStyles.hint, { color: theme.textMuted, marginTop: 24 }]}>{library.cloud ? '新导入的文件保存到账号，支持带字幕的音视频，单个文件最多 3 GB。此前的本地文件和记录仍保留在当前设备。' : '本地文件保存在当前设备，单个文件最多 100 MB。登录后可保存到云端，继续其他设备上的练习。'}</Text>
  </ScrollView></View>;
}
