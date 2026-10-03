import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { radius } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { speakingImportSources, type SpeakingImportSource } from './importSources';

export function SpeakingImportSources({ onSelect, selected, disabled = false }: {
  onSelect: (source: SpeakingImportSource) => void; selected?: SpeakingImportSource; disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  return <View accessibilityLabel="导入来源" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 18 }}>
    {speakingImportSources.map(source => <Pressable key={source.id} accessibilityRole="button"
      accessibilityLabel={`从${source.label}导入`} accessibilityState={{ selected: source.id === selected, disabled }}
      disabled={disabled} onPress={() => onSelect(source.id)} style={{ flexBasis: '30%', flexGrow: 1, minHeight: 84,
        alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.content,
        borderWidth: 1, borderColor: source.id === selected ? theme.accent : theme.border,
        backgroundColor: source.id === selected ? theme.accentSoft : 'transparent', opacity: disabled ? .5 : 1 }}>
      <Ionicons name={source.icon} size={24} color={theme.accent} />
      <Text style={{ color: theme.text, fontSize: 14 }}>{source.label}</Text>
    </Pressable>)}
  </View>;
}
