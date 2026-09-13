import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { getArticleImport } from '@/api/imports';
import { useAppTheme } from '@/context/ThemeContext';
import {
  clearActiveImportIdIfMatches,
  clearImportOperationKeys,
  loadActiveImportId,
  saveActiveImportId,
} from '@/features/imports/importStorage';
import { weight } from '@/constants/theme';

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '导入暂时无法继续，请稍后重试';
}

const PROCESSING_STATUSES = new Set([
  'awaiting_upload',
  'queued',
  'processing',
  'preview_ready',
  'retryable',
]);

/**
 * Kept as a compatibility route for links created by older app versions.
 * Ready imports now continue through the processing screen, which confirms
 * them automatically and opens the article without a review button.
 */
export default function ImportPreviewScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const paramId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const continueImport = async () => {
      try {
        const id = paramId ?? await loadActiveImportId();
        if (!id) {
          if (mounted) setMessage('找不到待处理的导入任务');
          return;
        }
        const loaded = await getArticleImport(id);
        if (!mounted) return;

        if (loaded.status === 'confirmed' && loaded.articleId) {
          await Promise.all([
            clearActiveImportIdIfMatches(loaded.id),
            clearImportOperationKeys(loaded.id),
          ]).catch(() => {});
          router.replace({ pathname: '/article-read', params: { id: loaded.articleId } });
          return;
        }

        if (PROCESSING_STATUSES.has(loaded.status)) {
          await saveActiveImportId(loaded.id);
          router.replace({ pathname: '/import-processing', params: { id: loaded.id } });
          return;
        }

        await clearActiveImportIdIfMatches(loaded.id).catch(() => {});
        setMessage(loaded.failure?.message ?? '导入暂时无法继续，请重新开始');
      } catch (error) {
        if (mounted) setMessage(messageFor(error));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void continueImport();
    return () => {
      mounted = false;
    };
  }, [paramId]);

  if (loading) {
    return <View style={[styles.centered, { backgroundColor: theme.bg }]}><ActivityIndicator color={theme.accent} /></View>;
  }

  return (
    <View
      style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>导入文章</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.content}>
        <View style={[styles.statusIcon, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="alert-outline" size={38} color={theme.danger} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>导入暂时无法继续</Text>
        {message ? <Text style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}
        <TouchableOpacity onPress={() => router.replace('/import')} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}>
          <Ionicons name="add" size={17} color={theme.blue} />
          <Text style={[styles.secondaryButtonText, { color: theme.blue }]}>开始新的导入</Text>
        </TouchableOpacity>
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
  message: { fontSize: 13, lineHeight: 20, marginTop: 14, textAlign: 'center' },
  secondaryButton: { alignItems: 'center', borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 20, minHeight: 46, paddingHorizontal: 16 },
  secondaryButtonText: { fontSize: 14, fontWeight: weight('semibold') },
});
