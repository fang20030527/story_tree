import React from 'react';
import { Text } from 'react-native';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

export function SpeakingSentence({ text, size, lookup, color }: { text: string; size: number; lookup: (term: string) => void; color?: string }) {
  const { theme } = useAppTheme();
  return <Text style={{ color: color ?? theme.text, fontFamily: fonts.reading, fontSize: size, lineHeight: size * 1.5 }}>{text.split(/([A-Za-z]+(?:['’\-][A-Za-z]+)*)/g).map((token, index) => /[A-Za-z]/.test(token) ? <Text key={index} accessibilityRole="button" accessibilityLabel={`查词 ${token}`} onPress={event => { event.stopPropagation(); lookup(token); }}>{token}</Text> : token)}</Text>;
}
