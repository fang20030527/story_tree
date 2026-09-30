import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';

export function ResponsiveFrame({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme();
  return <View style={[styles.outer, { backgroundColor: theme.bg }]}><View style={styles.frame}>{children}</View></View>;
}

export const pageContent = { width: '100%' as const, maxWidth: 760, alignSelf: 'center' as const, paddingHorizontal: 24 };

const styles = StyleSheet.create({
  outer: { flex: 1 },
  frame: { flex: 1, width: '100%', maxWidth: 1480, alignSelf: 'center' },
});
