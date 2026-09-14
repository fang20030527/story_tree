import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { retryArticleImport } from '@/api/imports';
import { useAppTheme } from '@/context/ThemeContext';
import { clearActiveImportIdIfMatches, clearImportOperationKeys, loadActiveImportId, loadOrCreateImportOperationKey } from '@/features/imports/importStorage';
import {
  autoConfirmArticleImport,
  importNeedsAutoConfirmation,
} from '@/features/imports/autoConfirm';
import { useImportPolling } from '@/features/imports/useImportPolling';
import { weight } from '@/constants/theme';

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '导入暂时无法完成，请稍后重试';
}

export default function ImportProcessingScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const paramId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [storedId, setStoredId] = useState<string | null>(paramId ?? null);
  const [loadingId, setLoadingId] = useState(!paramId);
  const [retrying, setRetrying] = useState(false);
  const [autoConfirmAttempt, setAutoConfirmAttempt] = useState(0);
  const [autoConfirmError, setAutoConfirmError] = useState<{ key: string; message: string } | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const autoConfirmOperationRef = React.useRef<{
    key: string;
    promise: Promise<string>;
  } | null>(null);

  useEffect(() => {
    if (paramId) return;
    let mounted = true;
    loadActiveImportId()
      .then((id) => {
        if (mounted) setStoredId(id);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingId(false);
      });
    return () => {
      mounted = false;
    };
  }, [paramId]);

  const importId = storedId;
  const {
    articleImport: polledImport,
    error: pollingStateError,
    retry: retryPolling,
  } = useImportPolling(importId);
  const articleImport = importId ? polledImport : null;
  const autoConfirmKey = articleImport
    ? `${articleImport.id}:${autoConfirmAttempt}`
    : null;
  const autoConfirmErrorForCurrentImport = autoConfirmKey && autoConfirmError?.key === autoConfirmKey
    ? autoConfirmError.message
    : null;
  const autoConfirming = importNeedsAutoConfirmation(articleImport) && !autoConfirmErrorForCurrentImport;

  useEffect(() => {
    if (!articleImport) return;
    if (articleImport.status === 'confirmed' && articleImport.articleId) {
      void Promise.all([
        clearActiveImportIdIfMatches(articleImport.id),
        clearImportOperationKeys(articleImport.id),
      ]).catch(() => {});
      router.replace({ pathname: '/article-read', params: { id: articleImport.articleId } });
    } else if (articleImport.status === 'failed' || articleImport.status === 'expired' || articleImport.status === 'cancelled') {
      void clearActiveImportIdIfMatches(articleImport.id).catch(() => {});
    }
  }, [articleImport]);

  useEffect(() => {
    if (!importNeedsAutoConfirmation(articleImport) || autoConfirmErrorForCurrentImport) {
      return;
    }

    let active = true;
    const operationKey = `${articleImport.id}:${autoConfirmAttempt}`;
    const existingOperation = autoConfirmOperationRef.current;
    const operation = existingOperation?.key === operationKey
      ? existingOperation
      : {
          key: operationKey,
          promise: autoConfirmArticleImport(articleImport),
        };
    autoConfirmOperationRef.current = operation;
    void operation.promise
      .then((articleId) => {
        if (active) {
          router.replace({ pathname: '/article-read', params: { id: articleId } });
        }
      })
      .catch((error) => {
        if (active) {
          setAutoConfirmError({ key: operationKey, message: messageFor(error) });
          // The request may have reached the server even when the response
          // was lost. Refresh once so a confirmed import still opens.
          retryPolling();
        }
      });

    return () => {
      active = false;
    };
  }, [articleImport, autoConfirmAttempt, autoConfirmErrorForCurrentImport, retryPolling]);

  const retry = async () => {
    if (!importId || retrying) return;
    setRetrying(true);
    setActionMessage(null);
    try {
      const key = await loadOrCreateImportOperationKey(importId, 'retry');
      await retryArticleImport(importId, key);
      retryPolling();
    } catch (error) {
      setActionMessage(messageFor(error));
    } finally {
      setRetrying(false);
    }
  };

  const retryAutoConfirm = () => {
    if (autoConfirming) return;
    setActionMessage(null);
    setAutoConfirmAttempt((attempt) => attempt + 1);
  };

  const statusLabel = useMemo(() => {
    switch (articleImport?.status) {
      case 'awaiting_upload': return '等待上传文件';
      case 'queued': return '已加入处理队列';
      case 'processing': return '正在解析正文';
      case 'preview_ready': return autoConfirmErrorForCurrentImport ? '保存文章失败' : '正在保存文章';
      case 'retryable': return '这次解析没有完成';
      case 'failed': return '导入失败';
      case 'expired': return '导入已过期';
      case 'cancelled': return '导入已取消';
      default: return '正在准备导入';
    }
  }, [articleImport?.status, autoConfirmErrorForCurrentImport]);

  if (loadingId) {
    return <View style={[styles.centered, { backgroundColor: theme.bg }]}><ActivityIndicator color={theme.accent} /></View>;
  }

  if (!importId) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回">
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>导入文章</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.content}>
          <View style={[styles.statusIcon, { backgroundColor: theme.surfaceAlt }]}>
            <Ionicons name="document-outline" size={38} color={theme.textMuted} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>没有待处理的导入</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>这个导入任务可能已完成、已过期，或暂时无法恢复。</Text>
          <TouchableOpacity onPress={() => router.replace('/import')} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}>
            <Ionicons name="add" size={17} color={theme.blue} />
            <Text style={[styles.secondaryButtonText, { color: theme.blue }]}>开始新的导入</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const terminal = articleImport?.status === 'failed' || articleImport?.status === 'expired' || articleImport?.status === 'cancelled';
  const retryable = articleImport?.status === 'retryable';
  const autoConfirmFailed = articleImport?.status === 'preview_ready' && Boolean(autoConfirmErrorForCurrentImport) && !autoConfirming;
  const pollingError = pollingStateError ? messageFor(pollingStateError) : null;
  const message = autoConfirmErrorForCurrentImport ?? actionMessage ?? articleImport?.failure?.message ?? pollingError;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>导入文章</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <View style={[styles.statusIcon, { backgroundColor: terminal || autoConfirmFailed ? theme.accentSoft : theme.accent }]}>
          {terminal || autoConfirmFailed ? <Ionicons name="alert-outline" size={38} color={theme.danger} /> : <ActivityIndicator color={theme.accentText} size="large" />}
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{statusLabel}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{terminal ? '你可以换一种方式导入文章。' : '导入完成后会自动加入书架并打开文章阅读；你可以放心离开，稍后回来会继续同一个导入任务。'}</Text>
        {articleImport?.status === 'processing' || articleImport?.status === 'queued' ? (
          <Text style={[styles.detail, { color: theme.textMuted }]}>通常需要几秒钟，图片 OCR 可能稍久一些。</Text>
        ) : null}
        {message ? <Text style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}
        {articleImport?.status === 'preview_ready' && autoConfirmErrorForCurrentImport && !autoConfirming ? (
          <TouchableOpacity onPress={retryAutoConfirm} style={[styles.primaryButton, { backgroundColor: theme.accent }]} activeOpacity={0.85}>
            <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>重试保存并打开</Text>
            <Ionicons name="refresh" size={18} color={theme.accentText} />
          </TouchableOpacity>
        ) : null}
        {retryable ? (
          <TouchableOpacity disabled={retrying} onPress={() => void retry()} style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: retrying ? 0.65 : 1 }]} activeOpacity={0.85}>
            {retrying ? <ActivityIndicator color={theme.accentText} /> : <><Text style={[styles.primaryButtonText, { color: theme.accentText }]}>重试解析</Text><Ionicons name="refresh" size={18} color={theme.accentText} /></>}
          </TouchableOpacity>
        ) : null}
        {pollingError && !terminal && !retryable ? (
          <TouchableOpacity onPress={retryPolling} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}>
            <Ionicons name="refresh-outline" size={17} color={theme.blue} />
            <Text style={[styles.secondaryButtonText, { color: theme.blue }]}>重新获取状态</Text>
          </TouchableOpacity>
        ) : null}
        {articleImport?.status === 'failed' && articleImport.sourceKind === 'url' ? (
          <>
            <TouchableOpacity onPress={() => router.replace({ pathname: '/import', params: { source: 'paste' } })} style={[styles.primaryButton, { backgroundColor: theme.accent }]} activeOpacity={0.85}>
              <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>改用粘贴正文</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace({ pathname: '/import', params: { source: 'album' } })} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}>
              <Text style={[styles.secondaryButtonText, { color: theme.blue }]}>导入正文截图</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {terminal ? (
          <TouchableOpacity onPress={() => router.replace('/import')} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={17} color={theme.blue} />
            <Text style={[styles.secondaryButtonText, { color: theme.blue }]}>返回选择导入方式</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  headerSpacer: { width: 26 },
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  statusIcon: { alignItems: 'center', borderRadius: 36, height: 72, justifyContent: 'center', width: 72 },
  title: { fontSize: 22, fontWeight: weight('bold'), marginTop: 22, textAlign: 'center' },
  subtitle: { fontSize: 14, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  detail: { fontSize: 12, marginTop: 12, textAlign: 'center' },
  message: { fontSize: 13, lineHeight: 20, marginTop: 14, textAlign: 'center' },
  primaryButton: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 24, minHeight: 50, minWidth: 160, paddingHorizontal: 18 },
  primaryButtonText: { fontSize: 15, fontWeight: weight('bold') },
  secondaryButton: { alignItems: 'center', borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 16, minHeight: 46, paddingHorizontal: 16 },
  secondaryButtonText: { fontSize: 14, fontWeight: weight('semibold') },
});
