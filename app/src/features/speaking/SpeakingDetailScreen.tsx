import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { radius } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { formatSpeakingTime } from './model';
import { speakingSectionTitle, speakingSourceLabel } from './catalog';
import { speakingAccentLabel } from './accents';
import { SpeakingButton, SpeakingHeader, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { speakingTitleText } from './titles';
import { useSpeakingLibrary } from './useSpeakingLibrary';
import { speakingOverview } from './overviews';
import { speakingCover } from './covers';
import { SpeakingTranscriptExport } from './SpeakingTranscriptExport';

export function SpeakingDetailScreen() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const library = useSpeakingLibrary(id);
  const material = library.materials.find(item => item.id === id);
  const overview = material ? speakingOverview(material) : undefined;
  const cover = material?.origin === 'platform' ? speakingCover(material.id) : undefined;
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="跟读素材" /><ScrollView contentContainerStyle={speakingStyles.content}>
    <SpeakingStatus loading={library.loading} error={library.error} retry={library.refresh} />
    {!library.loading && !material ? <Text style={{ color: theme.textMuted }}>素材不存在，请返回素材页。</Text> : null}
    {material ? <>
      {cover ? <View style={{ width: '100%', ...(material.category === '播客' ? { maxWidth: 280, aspectRatio: 1, alignSelf: 'center' as const, marginBottom: 20 } : { aspectRatio: 16 / 9 }), borderRadius: radius.content, overflow: 'hidden', backgroundColor: theme.surfaceAlt }}><Image source={cover} accessibilityLabel={`${material.title}封面`} resizeMode="cover" style={{ width: '100%', height: '100%' }} /></View> : null}
      <View style={{ paddingTop: 4, paddingBottom: 18, marginBottom: 18 }}><Text style={{ color: theme.textMuted, fontSize: 12.5 }}>{speakingSectionTitle(material.category)}</Text><Text style={{ color: theme.text, fontSize: 27, lineHeight: 36, fontWeight: '600', marginTop: 6 }}>{speakingTitleText(material.title)}</Text><Text style={{ color: theme.textSecondary, fontSize: 15, lineHeight: 23, marginTop: 12 }}>{speakingAccentLabel(material)} · {material.subtitle}</Text></View>
      <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{speakingSectionTitle(material.category)} · {formatSpeakingTime(material.duration)} · {material.cueCount ?? material.cues.length} 句 · {speakingSourceLabel(material)}</Text>
      <View style={{ marginTop: 28 }}>
        {overview ? <View style={{ marginBottom: 32 }}>
          <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 17, marginBottom: 12 }}>概述</Text>
          <Text style={{ color: theme.text, fontSize: 15, lineHeight: 26 }}>{overview}</Text>
        </View> : null}
        <SpeakingButton disabled={library.loading || Boolean(library.error)} label="开始影子跟读" onPress={() => router.push({ pathname: '/speaking/shadowing', params: { id: material.id } })} />
        <SpeakingTranscriptExport material={material} notes={library.store.notes[material.id]} disabled={library.loading || Boolean(library.error)} />
      </View>
    </> : null}
  </ScrollView></View>;
}
