import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { loginWithEmail } from '@/api/email';
import { registerAnonymous } from '@/api/practices';
import { Card } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { saveAuthUserEmail } from '@/features/auth/authStorage';

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '邮箱登录暂时无法使用，请稍后重试';
}

export default function LoginScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const login = async () => {
    if (loading) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail.includes('@')) {
      setMessage('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 8) {
      setMessage('密码至少需要 8 个字符');
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      await registerAnonymous(true);
      await loginWithEmail(normalizedEmail, password);
      try {
        await saveAuthUserEmail(normalizedEmail);
      } catch {
        // The login response is authoritative; the display-only email is best effort.
      }
      router.back();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.bg }]}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel="返回"
        >
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>邮箱登录</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <View style={styles.content}>
        <View style={[styles.brandMark, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="mail-outline" size={38} color={theme.accent} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>同步你的学习进度</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          首次使用会自动创建邮箱账号，之后可在不同设备继续使用。
        </Text>

        <Card theme={theme} style={styles.card}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="邮箱地址"
            placeholderTextColor={theme.textMuted}
            returnKeyType="next"
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="密码（至少 8 个字符）"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void login()}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />
          <TouchableOpacity
            onPress={() => void login()}
            disabled={loading}
            activeOpacity={0.85}
            style={[styles.emailButton, { backgroundColor: theme.accent, opacity: loading ? 0.65 : 1 }]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.emailButtonText}>邮箱登录 / 注册</Text>
            )}
          </TouchableOpacity>
          {message ? (
            <Text style={[styles.message, { color: theme.danger }]}>{message}</Text>
          ) : null}
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  headerPlaceholder: { width: 26 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 76, alignItems: 'center' },
  brandMark: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: weight('bold'), marginBottom: 10 },
  subtitle: { fontSize: 14, lineHeight: 22, textAlign: 'center', maxWidth: 300 },
  card: { width: '100%', marginTop: 36, padding: 16 },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 13,
    fontSize: 15,
    marginBottom: 12,
  },
  emailButton: {
    minHeight: 50,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailButtonText: { color: '#fff', fontSize: 16, fontWeight: weight('semibold') },
  message: { marginTop: 14, fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
