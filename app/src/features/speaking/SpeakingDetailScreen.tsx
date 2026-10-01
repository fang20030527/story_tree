import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { formatSpeakingTime } from './model';
import { speakingSourceLabel } from './catalog';
import { SpeakingButton, SpeakingHeader, SpeakingStatus, speakingStyles } from './SpeakingComponents';
import { useSpeakingLibrary } from './useSpeakingLibrary';

export function SpeakingDetailScreen() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const library = useSpeakingLibrary(id);
  const material = library.materials.find(item => item.id === id);
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="跟读素材" /><ScrollView contentContainerStyle={speakingStyles.content}>
    <SpeakingStatus loading={library.loading} error={library.error} retry={library.refresh} />
    {!library.loading && !material ? <Text style={{ color: theme.textMuted }}>素材不存在，请返回素材页。</Text> : null}
    {material ? <><View style={{ backgroundColor: theme.pink, padding: 28, borderRadius: 3, marginBottom: 26 }}><Text style={{ color: theme.onPink, fontSize: 11, letterSpacing: 2 }}>SPEAK A LITTLE MORE</Text><Text style={{ color: theme.onPink, fontFamily: fonts.display, fontSize: 46, lineHeight: 50, marginTop: 25 }}>{material.title}</Text><Text style={{ color: theme.onPink, fontSize: 18, marginTop: 24 }}>{material.subtitle}</Text></View><Text style={[speakingStyles.hint, { color: theme.textMuted }]}>{material.category} · {formatSpeakingTime(material.duration)} · {material.cueCount ?? material.cues.length} 句 · {speakingSourceLabel(material)}</Text><Text style={[speakingStyles.section, { color: theme.text }]}>先听一句，再跟着说。</Text><Text style={{ color: theme.text, fontFamily: fonts.reading, fontSize: 21, lineHeight: 32 }}>{material.cues[0]?.en}</Text><Text style={[speakingStyles.hint, { color: theme.textMuted, marginBottom: 32 }]}>{material.cues[0]?.zh}</Text><SpeakingButton disabled={library.loading || Boolean(library.error)} label="开始影子跟读" onPress={() => router.push({ pathname: '/speaking/shadowing', params: { id: material.id } })} /></> : null}
  </ScrollView></View>;
}
