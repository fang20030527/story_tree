import type { WordTranslationDto } from '@context-reader/contracts';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { lookupLocalWord } from '@/features/dictionary/lookup';

export function ShadowingDictionary({ term }: { term: string }) {
  const { theme } = useAppTheme();
  const [definition, setDefinition] = useState<WordTranslationDto | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void lookupLocalWord({ term }).then(value => { if (active) setDefinition(value); })
      .catch(() => { if (active) setError('本地词典未收录这个词，请检查拼写或尝试词语原形。'); });
    return () => { active = false; };
  }, [term]);
  return <View style={{ gap: 14 }}>
    <Text style={{ color: theme.text, fontFamily: fonts.reading, fontSize: 32 }}>{term}</Text>
    {!definition && !error ? <ActivityIndicator accessibilityLabel="正在查词" color={theme.accent} /> : null}
    {definition ? <>
      {definition.phoneticUk || definition.phoneticUs ? <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 23 }}>{[definition.phoneticUk && `英 ${definition.phoneticUk}`, definition.phoneticUs && `美 ${definition.phoneticUs}`].filter(Boolean).join('  ')}</Text> : null}
      <Text style={{ color: theme.accent, fontSize: 13 }}>{definition.partOfSpeech}</Text>
      <Text selectable style={{ color: theme.text, fontSize: 16, lineHeight: 28 }}>{definition.meaningZh}</Text>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.textMuted, fontSize: 14, lineHeight: 24 }}>{error}</Text> : null}
    <Text style={{ color: theme.textMuted, fontSize: 11, lineHeight: 20 }}>离线词典释义。结合原句选择合适含义。</Text>
  </View>;
}
