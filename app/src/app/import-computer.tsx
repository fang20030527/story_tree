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
import { hasConfirmedAge, saveAgeConfirmation } from '@/features/practice/practiceStorage';
import {
  clearActiveComputerSessionId,
  loadActiveComputerSession,
  saveActiveComputerSession,
  saveActiveImportId,
} from '@/features/imports/importStorage';
import { weight } from '@/constants/theme';

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
  const [ageConfirmed, setAgeConfirmed] = useState<boolean | null>(null);
  const [session, setSession] = useState<CreatedComputerUploadSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<string | null>(null);
  const createKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([hasConfirmedAge(), loadActiveComputerSession()])
      .then(async ([confirmed, storedSession]) => {
        if (!mounted) return;
        setAgeConfirmed(confirmed);
        if (confirmed && storedSession) {
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
        }
      })
      .catch(() => {
        if (mounted) setAgeConfirmed(false);
      });
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

  const confirmAge = async () => {
    try {
      await saveAgeConfirmation();
      setAgeConfirmed(true);
      setMessage(null);
    } catch {
      setMessage('暂时无法保存年龄确认，请重试');
    }
  };

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

  if (ageConfirmed === null) return <View style={[styles.centered, { backgroundColor: theme.bg }]}><ActivityIndicator color={theme.accent} /></View>;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回"><Ionicons name="chevron-back" size={26} color={theme.text} /></TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>导入 · 电脑</Text>
        <View style={styles.headerSpacer} />
      </View>
      {!ageConfirmed ? (
        <View style={styles.ageContent}><View style={[styles.ageCard, { backgroundColor: theme.surface, borderColor: theme.border }]}><View style={[styles.ageIcon, { backgroundColor: theme.accentSoft }]}><Ionicons name="shield-checkmark" size={34} color={theme.accent} /></View><Text style={[styles.ageTitle, { color: theme.text }]}>使用前请确认年龄</Text><Text style={[styles.ageBody, { color: theme.textSecondary }]}>电脑上传与文章服务仅面向年满 14 周岁的用户。</Text><TouchableOpacity onPress={() => void confirmAge()} style={[styles.primaryButton, { backgroundColor: theme.accent }]} activeOpacity={0.85}><Text style={[styles.primaryButtonText, { color: theme.accentText }]}>我已年满 14 周岁</Text></TouchableOpacity>{message ? <Text style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}</View></View>
      ) : (
        <View style={styles.content}>
          <View style={[styles.heroIcon, { backgroundColor: theme.accentSoft }]}><Ionicons name="laptop-outline" size={40} color={theme.accent} /></View>
          <Text style={[styles.title, { color: theme.text }]}>从电脑导入文章</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>在电脑浏览器打开上传页，输入一次性上传码即可把文件安全传到手机。</Text>
          {!session || sessionExpired ? (
            <TouchableOpacity disabled={creating} onPress={() => void createSession()} style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: creating ? 0.65 : 1 }]} activeOpacity={0.85}>{creating ? <ActivityIndicator color={theme.accentText} /> : <><Text style={[styles.primaryButtonText, { color: theme.accentText }]}>{session ? '重新生成上传码' : '生成上传码'}</Text><Ionicons name="key-outline" size={18} color={theme.accentText} /></>}</TouchableOpacity>
          ) : (
            <View style={[styles.codeCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.codeLabel, { color: theme.textMuted }]}>电脑端输入此上传码</Text>
              <Text style={[styles.code, { color: theme.text }]}>{session.uploadCode}</Text>
              <Text style={[styles.expiry, { color: remaining === '0:00' ? theme.danger : theme.textSecondary }]}>有效期还剩 {remaining ?? remainingLabel(session.expiresAt)}</Text>
              <View style={styles.codeActions}><TouchableOpacity onPress={() => void copyCode()} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}><Ionicons name="copy-outline" size={16} color={theme.blue} /><Text style={[styles.secondaryButtonText, { color: theme.blue }]}>复制上传码</Text></TouchableOpacity><TouchableOpacity onPress={() => void openBrowser()} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}><Ionicons name="open-outline" size={16} color={theme.blue} /><Text style={[styles.secondaryButtonText, { color: theme.blue }]}>打开上传页</Text></TouchableOpacity></View>
              <View style={[styles.urlBox, { backgroundColor: theme.surfaceAlt }]}><Text numberOfLines={2} style={[styles.urlText, { color: theme.textMuted }]}>{session.uploadUrl}</Text></View>
              <Text style={[styles.waiting, { color: theme.textSecondary }]}>等待电脑上传文件… 上传完成后会自动进入解析</Text>
            </View>
          )}
          {message ? <Text style={[styles.message, { color: message === '上传码已复制' ? theme.green : theme.danger }]}>{message}</Text> : null}
          <Text style={[styles.note, { color: theme.textMuted }]}>上传码十分钟内有效且只能使用一次。支持 PDF、DOCX、TXT、HTML 和常见图片格式。</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  headerSpacer: { width: 26 },
  content: { alignItems: 'center', flex: 1, paddingHorizontal: 24, paddingTop: 70 },
  heroIcon: { alignItems: 'center', borderRadius: 36, height: 72, justifyContent: 'center', width: 72 },
  title: { fontSize: 23, fontWeight: weight('bold'), marginTop: 20, textAlign: 'center' },
  subtitle: { fontSize: 14, lineHeight: 22, marginTop: 9, textAlign: 'center' },
  codeCard: { alignItems: 'center', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginTop: 24, padding: 18, width: '100%' },
  codeLabel: { fontSize: 12 },
  code: { fontSize: 31, fontWeight: weight('bold'), letterSpacing: 5, marginTop: 11 },
  expiry: { fontSize: 12, marginTop: 7 },
  codeActions: { flexDirection: 'row', gap: 8, marginTop: 16, width: '100%' },
  secondaryButton: { alignItems: 'center', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 42, paddingHorizontal: 8 },
  secondaryButtonText: { fontSize: 13, fontWeight: weight('semibold') },
  urlBox: { borderRadius: 8, marginTop: 12, paddingHorizontal: 10, paddingVertical: 8, width: '100%' },
  urlText: { fontSize: 10, lineHeight: 15 },
  waiting: { fontSize: 12, marginTop: 15, textAlign: 'center' },
  note: { fontSize: 12, lineHeight: 19, marginTop: 22, textAlign: 'center' },
  message: { fontSize: 13, lineHeight: 20, marginTop: 13, textAlign: 'center' },
  primaryButton: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 24, minHeight: 50, minWidth: 180, paddingHorizontal: 18 },
  primaryButtonText: { fontSize: 15, fontWeight: weight('bold') },
  ageContent: { flex: 1, justifyContent: 'center', padding: 24 },
  ageCard: { alignItems: 'center', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 24 },
  ageIcon: { alignItems: 'center', borderRadius: 32, height: 64, justifyContent: 'center', width: 64 },
  ageTitle: { fontSize: 20, fontWeight: weight('bold'), marginTop: 18 },
  ageBody: { fontSize: 14, lineHeight: 22, marginTop: 10, textAlign: 'center' },
});
