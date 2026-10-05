import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
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

import { checkUsername } from '@context-reader/contracts';

import { ApiError } from '@/api/client';
import { confirmPasswordReset, loginWithEmail, requestPasswordReset } from '@/api/email';
import { registerAnonymous } from '@/api/practices';
import { BrandLogo } from '@/components/brand';
import { confirmAction, notify } from '@/components/confirm';
import { radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { clearAuthUser, saveAuthUserEmail } from '@/features/auth/authStorage';

function messageFor(error: unknown, fallback = '操作暂时无法完成，请稍后重试'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type ScreenMode = 'login' | 'request' | 'reset';

export default function LoginScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmedPassword, setConfirmedPassword] = useState('');
  const [mode, setMode] = useState<ScreenMode>('login');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'error' | 'info'>('error');
  const [resendSeconds, setResendSeconds] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds(resendSeconds - 1), 1_000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  const showError = (value: string) => {
    setMessageTone('error');
    setMessage(value);
  };

  const showInfo = (value: string) => {
    setMessageTone('info');
    setMessage(value);
  };

  const changeMode = (nextMode: ScreenMode) => {
    if (mode === 'reset' && nextMode !== 'reset') {
      setCode('');
      setNewPassword('');
      setConfirmedPassword('');
    }
    setMode(nextMode);
    setMessage(null);
  };

  const login = async () => {
    if (loading) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail.includes('@')) {
      showError('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 8) {
      showError('密码至少需要 8 个字符');
      return;
    }
    // 用户名只在创建新账号时使用；留空由服务端自动生成，已有账号登录会忽略它。
    let newUsername: string | undefined;
    if (username.trim()) {
      const checked = checkUsername(username);
      if (!checked.ok) {
        showError(checked.message);
        return;
      }
      newUsername = checked.username;
    }

    await signIn(normalizedEmail, newUsername, false);
  };

  /**
   * Bind this device to the email account. `startOver` first replaces the local guest identity
   * with an empty one: the server refuses to bind a guest that already has study data to an
   * existing account, and there is no merge.
   */
  const signIn = async (normalizedEmail: string, newUsername: string | undefined, startOver: boolean) => {
    setLoading(true);
    setMessage(null);
    try {
      if (startOver) await clearAuthUser();
      try {
        await registerAnonymous(true);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'TOKEN_REVOKED') throw error;
        await clearAuthUser();
        await registerAnonymous(true);
      }
      const result = await loginWithEmail(normalizedEmail, password, newUsername);
      try {
        await saveAuthUserEmail(normalizedEmail);
      } catch {
        // The login response is authoritative; the display-only email is best effort.
      }
      if (result.created) {
        // Login and sign-up share one form, so a mistyped address silently opens a new, empty account.
        notify('已创建新账号', `已用 ${normalizedEmail} 创建新账号。如果你之前注册过，请检查邮箱是否输入正确。`);
      }
      router.back();
    } catch (error) {
      if (!startOver && error instanceof ApiError && error.code === 'AUTH_ACCOUNT_CONFLICT') {
        confirmAction({
          title: '这台设备上有游客学习记录',
          message: '游客记录（生词、练习等）无法合并到已有账号。继续登录后，这台设备将改用该账号的数据，游客记录不再显示。',
          confirmLabel: '继续登录',
          destructive: true,
        }, () => { void signIn(normalizedEmail, newUsername, true); });
        return;
      }
      showError(messageFor(error, '邮箱登录暂时无法使用，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  const requestReset = async () => {
    if (loading) return;
    if (mode === 'reset' && resendSeconds > 0) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      showError('请输入有效的邮箱地址');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const response = await requestPasswordReset(normalizedEmail);
      setEmail(normalizedEmail);
      setCode('');
      setResendSeconds(60);
      setMode('reset');
      showInfo(`${response.message}。验证码 15 分钟内有效。`);
    } catch (error) {
      showError(messageFor(error));
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    if (loading) return;
    const normalizedCode = code.replace(/[\s-]/gu, '').toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{12}$/u.test(normalizedCode)) {
      showError('请输入邮件中的 12 位验证码');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      showError('新密码需要 8–128 个字符');
      return;
    }
    if (newPassword !== confirmedPassword) {
      showError('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const response = await confirmPasswordReset(email, normalizedCode, newPassword);
      try {
        await clearAuthUser();
      } catch {
        // A revoked local token is also recovered on the next login attempt.
      }
      setPassword('');
      setNewPassword('');
      setConfirmedPassword('');
      setCode('');
      setMode('login');
      showInfo(response.message);
    } catch (error) {
      showError(messageFor(error));
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
          onPress={() => {
            if (mode === 'login') router.back();
            else changeMode(mode === 'reset' ? 'request' : 'login');
          }}
          hitSlop={8}
          accessibilityLabel="返回"
        >
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {mode === 'login' ? '邮箱登录' : '重置密码'}
        </Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, keyboardVisible && styles.contentWithKeyboard]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.hero, keyboardVisible && styles.heroHidden]}>
          <View style={styles.brandMark}><BrandLogo width={58} /></View>
          <Text style={[styles.title, { color: theme.text }]}>
            {mode === 'login' ? '同步你的学习进度' : mode === 'request' ? '找回邮箱账号' : '设置新密码'}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {mode === 'login'
              ? '首次使用会自动创建邮箱账号，之后可在不同设备继续使用。'
              : mode === 'request'
                ? '输入注册邮箱，我们会发送一次性验证码。'
                : `请输入发送至 ${email} 的验证码。`}
          </Text>
        </View>

        <View style={[styles.card, keyboardVisible && styles.cardWithKeyboard]}>
          {mode !== 'reset' ? <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="邮箱地址"
            placeholderTextColor={theme.textMuted}
            returnKeyType={mode === 'login' ? 'next' : 'go'}
            submitBehavior={mode === 'login' ? 'submit' : 'blurAndSubmit'}
            onSubmitEditing={() => {
              if (mode === 'login') passwordInputRef.current?.focus();
              else void requestReset();
            }}
            style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]}
          /> : null}
          {mode === 'login' ? <TextInput
            ref={passwordInputRef}
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
            style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]}
          /> : null}
          {mode === 'login' ? <>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="用户名"
              placeholder="用户名（新用户选填）"
              placeholderTextColor={theme.textMuted}
              returnKeyType="go"
              onSubmitEditing={() => void login()}
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]}
            />
            <Text style={[styles.hint, { color: theme.textMuted }]}>
              仅创建新账号时使用，会公开显示在留言瓶。2–24 个字符；留空将自动生成，之后可在「我的」中修改。
            </Text>
          </> : null}
          {mode === 'reset' ? <>
            <TextInput
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="12 位邮箱验证码"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]}
            />
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="newPassword"
              placeholder="新密码（至少 8 个字符）"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]}
            />
            <TextInput
              value={confirmedPassword}
              onChangeText={setConfirmedPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="newPassword"
              placeholder="再次输入新密码"
              placeholderTextColor={theme.textMuted}
              returnKeyType="go"
              onSubmitEditing={() => void resetPassword()}
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceAlt }]}
            />
          </> : null}
          <TouchableOpacity
            onPress={() => void (mode === 'login' ? login() : mode === 'request' ? requestReset() : resetPassword())}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={mode === 'login' ? '邮箱登录或注册' : mode === 'request' ? '发送验证码' : '提交新密码'}
            style={[styles.emailButton, { backgroundColor: theme.accent, opacity: loading ? 0.65 : 1 }]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.emailButtonText, { color: theme.accentText }]}>
                {mode === 'login' ? '邮箱登录 / 注册' : mode === 'request' ? '发送验证码' : '重置密码'}
              </Text>
            )}
          </TouchableOpacity>
          {mode === 'login' ? <TouchableOpacity
            onPress={() => changeMode('request')}
            disabled={loading}
            accessibilityRole="button"
            style={styles.secondaryButton}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.accent }]}>忘记密码？</Text>
          </TouchableOpacity> : null}
          {mode === 'reset' ? <TouchableOpacity
            onPress={() => void requestReset()}
            disabled={loading || resendSeconds > 0}
            accessibilityRole="button"
            style={styles.secondaryButton}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.accent, opacity: resendSeconds > 0 ? 0.6 : 1 }]}>
              {resendSeconds > 0 ? `${resendSeconds} 秒后可重新发送` : '重新发送验证码'}
            </Text>
          </TouchableOpacity> : null}
          {message ? (
            <Text style={[styles.message, { color: messageTone === 'error' ? theme.danger : theme.textSecondary }]}>{message}</Text>
          ) : null}
          <Text style={[styles.message, { color: theme.textMuted }]}>
            登录即表示你已阅读并同意
            <Text accessibilityRole="link" onPress={() => router.push('/privacy')} style={{ color: theme.accent }}>《隐私政策》</Text>
            ，你的账号和学习数据保存在中国大陆以外的服务器。
          </Text>
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
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', flexGrow: 1, paddingHorizontal: 28, paddingTop: 40, paddingBottom: 32 },
  contentWithKeyboard: { paddingTop: 16 },
  hero: {},
  heroHidden: { display: 'none' },
  brandMark: { marginBottom: 22 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: weight('bold'), marginBottom: 10 },
  subtitle: { fontSize: 15, lineHeight: 24 },
  card: { width: '100%', marginTop: 32 },
  cardWithKeyboard: { marginTop: 0 },
  input: {
    minHeight: 50,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    fontSize: 15,
    marginBottom: 10,
  },
  emailButton: {
    minHeight: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailButtonText: { fontSize: 16, fontWeight: weight('semibold') },
  hint: { fontSize: 12, lineHeight: 18, paddingHorizontal: 6, marginTop: -2, marginBottom: 12 },
  secondaryButton: { alignSelf: 'flex-start', paddingVertical: 12, marginTop: 4 },
  secondaryButtonText: { fontSize: 14, fontWeight: weight('medium') },
  message: { marginTop: 14, fontSize: 13, lineHeight: 20 },
});
