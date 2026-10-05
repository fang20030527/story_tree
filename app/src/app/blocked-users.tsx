import type { BlockedUser } from '@context-reader/contracts';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { getBlockedUsers, unblockUser } from '@/api/messageBottles';
import { ListGroup, SubpageHeader, TextAction } from '@/components/subpage';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

/** 在留言瓶里屏蔽的用户；解除后重新能看到对方的留言。 */
export default function BlockedUsersScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers(await getBlockedUsers());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '暂时无法读取，请稍后重试');
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const unblock = async (user: BlockedUser) => {
    setPending(user.userId);
    try {
      await unblockUser(user.userId);
      setUsers((current) => current?.filter((entry) => entry.userId !== user.userId) ?? null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '解除屏蔽失败，请稍后重试');
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SubpageHeader title="已屏蔽的用户" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {users === null && !error ? <ActivityIndicator color={theme.accent} style={styles.state} /> : null}
        {error ? (
          <View style={styles.state}>
            <Text style={[styles.hint, { color: theme.danger }]}>{error}</Text>
            <TextAction label="重试" onPress={() => void load()} />
          </View>
        ) : null}
        {users?.length === 0 ? <Text style={[styles.hint, styles.state, { color: theme.textMuted }]}>没有屏蔽任何人。在留言瓶里点留言右侧的「···」可以屏蔽对方。</Text> : null}
        {users?.length ? (
          <ListGroup>
            {users.map((user) => (
              <View key={user.userId} style={styles.row}>
                <Text style={[styles.name, { color: theme.text }]}>{user.username ?? '已注销的用户'}</Text>
                <TextAction label={pending === user.userId ? '正在解除…' : '解除屏蔽'} disabled={pending !== null}
                  accessibilityLabel={`解除屏蔽 ${user.username ?? '已注销的用户'}`} onPress={() => void unblock(user)} />
              </View>
            ))}
          </ListGroup>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 12 },
  state: { paddingVertical: 28, alignItems: 'center', gap: 12 },
  hint: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 52 },
  name: { fontSize: 15, fontWeight: weight('medium'), flexShrink: 1 },
});
