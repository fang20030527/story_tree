import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppTheme } from '@/context/ThemeContext';

export function EditorialRemoteStatus({ loading, retry }: {
  loading: boolean;
  retry: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {loading ? <ActivityIndicator color={theme.blue} /> : null}
      <Text style={[styles.message, { color: theme.textMuted }]}>
        {loading ? '正在加载外刊…' : '暂时无法读取这篇外刊'}
      </Text>
      {!loading ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="重试加载外刊" onPress={retry}>
          <Text style={{ color: theme.blue }}>重试</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  message: { fontSize: 15 },
});
