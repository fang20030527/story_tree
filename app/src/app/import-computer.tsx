import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { createComputerUploadSession, getComputerUploadSession } from '@/api/imports';
import { createIdempotencyKey } from '@/api/installation';
import { registerAnonymous } from '@/api/practices';
import { type CreatedComputerUploadSession } from '@context-reader/contracts';
import { useAppTheme } from '@/context/ThemeContext';
import {
  clearActiveComputerSessionId,
  loadActiveComputerSession,
  saveActiveComputerSession,
  saveActiveImportId,
} from '@/features/imports/importStorage';
import { fonts, radius, weight } from '@/constants/theme';

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '电脑上传暂时无法使用';
}

function remainingLabel(expiresAt: string): string {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function ComputerImportScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<CreatedComputerUploadSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<string | null>(null);
  const createKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadActiveComputerSession()
      .then(async (storedSession) => {
        if (!mounted || !storedSession) return;
        try {
          const current = await getComputerUploadSession(storedSession.sessionId);
          if (mounted && (current.status === 'awaiting_code' || current.status === 'claimed')) setSession(storedSession);
          else await clearActiveComputerSessionId().catch(() => {});
        } catch (error) {
          // A transient outage must not discard the durable session. Keep it
          // around so the polling effect can resume when the app is online
          // again; only a non-retryable response proves it is no longer
          // usable.
          if (error instanceof ApiError && error.retryable) {
            setSession(storedSession);
            setRemaining(remainingLabel(storedSession.expiresAt));
            setMessage(messageFor(error));
          } else {
            await clearActiveComputerSessionId().catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let appState = AppState.currentState;
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const poll = async () => {
      if (cancelled || appState !== 'active') return;
      setRemaining(remainingLabel(session.expiresAt));
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        setMessage('上传码已过期，请重新生成');
        return;
      }
      try {
        const current = await getComputerUploadSession(session.sessionId);
        if (cancelled) return;
        if (current.status === 'uploaded') {
          await saveActiveImportId(current.importId);
          await clearActiveComputerSessionId().catch(() => {});
          router.replace({ pathname: '/import-processing', params: { id: current.importId } });
          return;
        }
        if (current.status === 'expired') {
          createKeyRef.current = null;
          setSession(null);
          await clearActiveComputerSessionId().catch(() => {});
          setMessage('上传码已过期，请重新生成');
          return;
        }
        timer = setTimeout(() => void poll(), 1_500);
      } catch (error) {
        if (!cancelled) setMessage(messageFor(error));
      }
    };
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState === 'active';
      appState = nextState;
      clearTimer();
      if (!wasActive && nextState === 'active') void poll();
    });
    void poll();
    const countdown = setInterval(() => {
      if (!cancelled) setRemaining(remainingLabel(session.expiresAt));
    }, 1_000);
    return () => {
      cancelled = true;
      clearTimer();
      clearInterval(countdown);
      subscription.remove();
    };
  }, [session]);

  const createSession = async () => {
    if (creating) return;
    if (Platform.OS === 'web') {
      setMessage('请在 iOS 或 Android 客户端生成电脑上传码');
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      // A new idempotency key is required after an expired session; replaying
      // the previous key would correctly return that same expired resource.
      if (session && new Date(session.expiresAt).getTime() <= Date.now()) {
        createKeyRef.current = null;
      }
      const key = createKeyRef.current ?? (createKeyRef.current = await createIdempotencyKey());
      await registerAnonymous(true);
      const created = await createComputerUploadSession(key);
      setSession(created);
      setRemaining(remainingLabel(created.expiresAt));
      await saveActiveComputerSession(created);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setCreating(false);
    }
  };

  const copyCode = async () => {
    if (!session) return;
    await Clipboard.setStringAsync(session.uploadCode);
    setMessage('上传码已复制');
  };

  const openBrowser = async () => {
    if (!session) return;
    try {
      if (Platform.OS === 'web') await Linking.openURL(session.uploadUrl);
      else await WebBrowser.openBrowserAsync(session.uploadUrl);
    } catch {
      setMessage('无法打开浏览器，请手动访问上传地址');
    }
  };

  const sessionExpired = Boolean(session && remaining === '0:00');

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回"><Ionicons name="chevron-back" size={26} color={theme.text} /></TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>导入 · 电脑</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>从电脑导入文章</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>在电脑浏览器打开上传页，输入一次性上传码即可把文件安全传到手机。</Text>
        {!session || sessionExpired ? (
          <TouchableOpacity disabled={creating} onPress={() => void createSession()} style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: creating ? 0.65 : 1 }]} activeOpacity={0.85}>{creating ? <ActivityIndicator color={theme.accentText} /> : <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>{session ? '重新生成上传码' : '生成上传码'}</Text>}</TouchableOpacity>
        ) : (
          <View style={[styles.codeCard, { borderTopColor: theme.text, borderBottomColor: theme.border }]}>
            <Text style={[styles.codeLabel, { color: theme.textMuted }]}>电脑端输入此上传码</Text>
            <Text style={[styles.code, { color: theme.text }]}>{session.uploadCode}</Text>
            <Text style={[styles.expiry, { color: remaining === '0:00' ? theme.danger : theme.textSecondary }]}>有效期还剩 {remaining ?? remainingLabel(session.expiresAt)}</Text>
            <View style={styles.codeActions}><TouchableOpacity onPress={() => void copyCode()} style={[styles.secondaryButton, { borderColor: theme.accent }]} activeOpacity={0.8}><Text style={[styles.secondaryButtonText, { color: theme.accent }]}>复制上传码</Text></TouchableOpacity><TouchableOpacity onPress={() => void openBrowser()} style={[styles.secondaryButton, { borderColor: theme.accent }]} activeOpacity={0.8}><Text style={[styles.secondaryButtonText, { color: theme.accent }]}>打开上传页</Text></TouchableOpacity></View>
            <View style={[styles.urlBox, { backgroundColor: theme.surfaceAlt }]}><Text numberOfLines={2} style={[styles.urlText, { color: theme.textMuted }]}>{session.uploadUrl}</Text></View>
            <Text style={[styles.waiting, { color: theme.textSecondary }]}>等待电脑上传文件… 上传完成后会自动进入解析</Text>
          </View>
        )}
        {message ? <Text style={[styles.message, { color: message === '上传码已复制' ? theme.success : theme.danger }]}>{message}</Text> : null}
        <Text style={[styles.note, { color: theme.textMuted }]}>上传码十分钟内有效且只能使用一次。支持 PDF、DOCX、TXT、HTML 和常见图片格式。</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  headerSpacer: { width: 26 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: weight('bold') },
  subtitle: { fontSize: 15, lineHeight: 24, marginTop: 8 },
  codeCard: { borderTopWidth: 2, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 28, paddingTop: 14, paddingBottom: 18, width: '100%' },
  codeLabel: { fontSize: 12 },
  code: { fontFamily: fonts.display, fontSize: 44, lineHeight: 52, letterSpacing: 6, marginTop: 8 },
  expiry: { fontSize: 12, marginTop: 7 },
  codeActions: { flexDirection: 'row', gap: 8, marginTop: 16, width: '100%' },
  secondaryButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1.5, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 42, paddingHorizontal: 8 },
  secondaryButtonText: { fontSize: 13, fontWeight: weight('semibold') },
  urlBox: { marginTop: 12, width: '100%' },
  urlText: { fontSize: 10, lineHeight: 15 },
  waiting: { fontSize: 12, marginTop: 15, textAlign: 'center' },
  note: { fontSize: 12, lineHeight: 19, marginTop: 22, textAlign: 'center' },
  message: { fontSize: 13, lineHeight: 20, marginTop: 13, textAlign: 'center' },
  primaryButton: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: radius.pill, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 24, minHeight: 50, minWidth: 180, paddingHorizontal: 22 },
  primaryButtonText: { fontSize: 15, fontWeight: weight('bold') },
});
