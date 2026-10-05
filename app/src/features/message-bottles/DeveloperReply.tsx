import type { MessageBottleReply } from '@context-reader/contracts';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

export function DeveloperReply({ reply }: { reply: MessageBottleReply }) {
  const { theme } = useAppTheme();
  return <View style={[styles.reply, { borderLeftColor: theme.accent, backgroundColor: theme.bg }]}>
    <View style={styles.meta}>
      <Text style={[styles.label, { color: theme.accent }]}>开发者回复</Text>
      <Text style={[styles.time, { color: theme.textMuted }]}>{new Date(reply.updatedAt).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      })}{reply.updatedAt !== reply.createdAt ? ' · 已编辑' : ''}</Text>
    </View>
    <Text selectable style={[styles.content, { color: theme.textSecondary }]}>{reply.content}</Text>
  </View>;
}
const styles = StyleSheet.create({
  reply: { borderLeftWidth: 3, borderRadius: 10, padding: 12, marginTop: 14 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, fontWeight: weight('semibold') }, time: { fontSize: 11 },
  content: { fontSize: 14, lineHeight: 23, marginTop: 6 },
});
