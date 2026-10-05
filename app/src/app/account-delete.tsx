import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteAccount } from '@/api/account';
import { ApiError } from '@/api/client';
import { ACTIVE_IMPORT_ID_KEY, ACTIVE_PRACTICE_ID_KEY } from '@/api/storage';
import { confirmAction, notify } from '@/components/confirm';
import { PrimaryAction, SubpageHeader } from '@/components/subpage';
import { radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { clearAuthUser, loadAuthUser, loadAuthUserEmail } from '@/features/auth/authStorage';
import { speakingStorageKey } from '@/features/speaking/speakingStorage';

const DELETED = [
  '账号、用户名和登录方式（邮箱或微信）',
  '生词本、练习文章、作答和复习记录',
  '导入的文章、翻译、口语文件和录音',
  '在留言瓶发布的留言、举报和屏蔽记录',
];

type Account = { registered: boolean; email: string | null };

/** 注销账号（App Store 审核指南 5.1.1(v)）：删除账号和全部云端数据，不可恢复。 */
export default function AccountDeleteScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState<Account | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([loadAuthUser(), loadAuthUserEmail()])
      .then(([user, email]) => { if (active) setAccount({ registered: Boolean(user), email: user ? email : null }); })
      .catch(() => { if (active) setAccount({ registered: false, email: null }); });
    return () => { active = false; };
  }, []);

  const needsPassword = Boolean(account?.email);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const localStore = await speakingStorageKey();
      try {
        await deleteAccount(needsPassword ? password : undefined);
      } catch (cause) {
        // A retry after a lost response finds the token already gone: the account was deleted.
        if (!(cause instanceof ApiError && (cause.code === 'UNAUTHORIZED' || cause.code === 'TOKEN_REVOKED'))) throw cause;
      }
      await AsyncStorage.multiRemove([localStore, ACTIVE_PRACTICE_ID_KEY, ACTIVE_IMPORT_ID_KEY]).catch(() => undefined);
      await clearAuthUser();
      notify('账号已注销', '账号和云端数据已删除。');
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '注销没有完成，请稍后重试');
    } finally {
      setBusy(false);
    }
  };
  const confirm = () => confirmAction({
    title: '永久注销账号？',
    message: '账号和全部云端数据会立即删除，无法恢复。',
    confirmLabel: '永久注销',
    destructive: true,
  }, () => { void remove(); });

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SubpageHeader title="注销账号" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <Text style={[styles.lead, { color: theme.text }]}>
          {account?.registered ? '注销后，以下数据会从云端永久删除：' : '你目前是游客。删除后，这台设备在云端的以下数据会永久删除：'}
        </Text>
        {DELETED.map((item) => (
          <Text key={item} style={[styles.item, { color: theme.textSecondary }]}>· {item}</Text>
        ))}
        <Text style={[styles.note, { color: theme.textMuted }]}>
          删除后无法恢复，也不能再用这个账号登录；同一邮箱可以重新注册一个空账号。今天已用的免费练习次数不会因为注销而恢复。只保存在这台设备上的阅读记录和收藏不受影响。
        </Text>
        {needsPassword ? (
          <>
            <Text style={[styles.label, { color: theme.textSecondary }]}>输入 {account?.email} 的登录密码以确认</Text>
            <TextInput accessibilityLabel="登录密码" value={password} onChangeText={(value) => { setPassword(value); setError(null); }}
              secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} placeholder="登录密码" placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]} />
          </>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        <PrimaryAction label={account?.registered ? '永久注销账号' : '删除云端数据'} busy={busy}
          disabled={!account || (needsPassword && password.length === 0)} onPress={confirm} style={styles.action} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 8 },
  lead: { fontSize: 16, fontWeight: weight('semibold'), lineHeight: 24, marginBottom: 10 },
  item: { fontSize: 14, lineHeight: 24 },
  note: { fontSize: 13, lineHeight: 21, marginTop: 14 },
  label: { fontSize: 13, marginTop: 22, marginBottom: 8 },
  input: { borderRadius: radius.content, minHeight: 46, paddingHorizontal: 14, fontSize: 15 },
  error: { fontSize: 13, lineHeight: 20, marginTop: 12 },
  action: { marginTop: 24 },
});
