import { Ionicons } from '@expo/vector-icons';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, checkUsername } from '@context-reader/contracts';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAccountProfile, updateUsername } from '@/api/account';
import { ApiError } from '@/api/client';
import { radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type Status = 'loading' | 'ready' | 'guest' | 'error';

function ActionButton({ label, onPress, busy = false }: { label: string; onPress: () => void; busy?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.button, { backgroundColor: theme.accent, opacity: busy ? 0.65 : 1 }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : (
        <Text style={[styles.buttonText, { color: theme.accentText }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

/** 查看并修改当前账号的公开用户名；从「我的」和留言瓶进入。 */
export default function UsernameScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('loading');
  const [current, setCurrent] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const savingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getAccountProfile().then(profile => {
      if (!active) return;
      if (profile.kind !== 'registered') {
        setStatus('guest');
        return;
      }
      setCurrent(profile.username);
      setValue(profile.username ?? '');
      setStatus('ready');
    }, error => {
      if (!active) return;
      setMessage(messageFor(error, '用户名暂时无法读取，请稍后重试'));
      setStatus('error');
    });
    return () => { active = false; };
  }, [attempt]);

  const retry = () => {
    setStatus('loading');
    setMessage(null);
    setAttempt(count => count + 1);
  };

  const save = async () => {
    if (savingRef.current) return;
    const checked = checkUsername(value);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }
    if (checked.username === current) {
      router.back();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      await updateUsername(checked.username);
      if (mounted.current) router.back();
    } catch (error) {
      if (mounted.current) setMessage(messageFor(error, '用户名暂时无法保存，请稍后重试'));
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.bg }]}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>用户名</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: theme.text }]}>你的公开名字</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          用户名会显示在留言瓶等公开位置，其他人都能看到。请不要使用邮箱、手机号等隐私信息。
        </Text>

        <View style={styles.card}>
          {status === 'loading' ? <ActivityIndicator color={theme.accent} style={styles.loading} /> : null}
          {status === 'guest' ? (
            <>
              <Text style={[styles.hint, { color: theme.textSecondary }]}>登录后才能设置用户名。</Text>
              <ActionButton label="去登录" onPress={() => router.replace('/login')} />
            </>
          ) : null}
          {status === 'error' ? (
            <>
              {message ? <Text accessibilityRole="alert" style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}
              <ActionButton label="重试" onPress={retry} />
            </>
          ) : null}
          {status === 'ready' ? (
            <>
              <TextInput
                value={value}
                onChangeText={(text) => { setValue(text); setMessage(null); }}
                editable={!saving}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="用户名"
                placeholder={`${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符`}
                placeholderTextColor={theme.textMuted}
                returnKeyType="go"
                onSubmitEditing={() => void save()}
                style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]}
              />
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {`${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符，可用文字、数字、下划线、点、连字符和间隔号；不区分大小写，不能与他人重复。已发布的留言保留发布时的署名。`}
              </Text>
              {message ? <Text accessibilityRole="alert" style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}
              <ActionButton label="保存" onPress={() => void save()} busy={saving} />
            </>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  header: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  headerPlaceholder: { width: 26 },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', flexGrow: 1, paddingHorizontal: 28, paddingTop: 32, paddingBottom: 32 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: weight('bold'), marginBottom: 10 },
  subtitle: { fontSize: 15, lineHeight: 24 },
  card: { width: '100%', marginTop: 28 },
  loading: { marginVertical: 24 },
  input: {
    minHeight: 50,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    fontSize: 15,
    marginBottom: 10,
  },
  hint: { fontSize: 12, lineHeight: 18, paddingHorizontal: 6, marginBottom: 12 },
  button: {
    minHeight: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: weight('semibold') },
  message: { fontSize: 13, lineHeight: 20, marginBottom: 12 },
});
