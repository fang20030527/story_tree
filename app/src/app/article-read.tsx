import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ImportedArticleDto, TranslationRequest } from '@context-reader/contracts';

import { ApiError } from '@/api/client';
import { getImportedArticle } from '@/api/articles';
import {
  getArticleTranslation,
  requestArticleTranslation,
} from '@/api/imports';
import { createIdempotencyKey } from '@/api/installation';
import { useAppTheme } from '@/context/ThemeContext';
import type { Theme } from '@/constants/theme';
import { weight } from '@/constants/theme';
import {
  isFavorite,
  recordImportedRecentView,
  toggleFavorite,
} from '@/features/library/libraryStorage';

type TranslationState = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  text: string | null;
  error: string | null;
};

const INITIAL_TRANSLATION: TranslationState = { status: 'idle', text: null, error: null };

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '翻译暂时无法完成';
}

function sourceLabel(sourceKind: ImportedArticleDto['sourceKind']): string {
  switch (sourceKind) {
    case 'url': return '网页链接';
    case 'paste': return '粘贴正文';
    case 'album': return '相册';
    case 'local_file': return '本地文件';
    case 'computer': return '电脑上传';
  }
}

export default function ArticleReadScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const articleId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [article, setArticle] = useState<ImportedArticleDto | null>(null);
  const [loading, setLoading] = useState(Boolean(articleId));
  const [message, setMessage] = useState<string | null>(articleId ? null : '找不到文章');
  const [fullTranslation, setFullTranslation] = useState<TranslationState>(INITIAL_TRANSLATION);
  const [paragraphTranslations, setParagraphTranslations] = useState<Record<string, TranslationState>>({});
  const [favorite, setFavorite] = useState(false);
  const translationKeysRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!articleId) {
      return;
    }
    let mounted = true;
    getImportedArticle(articleId)
      .then((loaded) => {
        if (!mounted) return;
        setArticle(loaded);
        void recordImportedRecentView({
          articleId: loaded.id,
          title: loaded.title,
          sourceKind: loaded.sourceKind,
          wordCount: loaded.wordCount,
        });
        void isFavorite(loaded.id).then((saved) => {
          if (mounted) setFavorite(saved);
        });
      })
      .catch((error) => {
        if (mounted) setMessage(messageFor(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [articleId]);

  const onToggleFavorite = async () => {
    if (!article) return;
    const next = await toggleFavorite({
      articleId: article.id,
      title: article.title,
      sourceKind: article.sourceKind,
      wordCount: article.wordCount,
    });
    setFavorite(next);
  };

  const translate = async (request: TranslationRequest, key: string) => {
    if (!articleId) return;
    const setState = (next: TranslationState) => {
      if (request.scope === 'full') setFullTranslation(next);
      else setParagraphTranslations((current) => ({ ...current, [request.paragraphId]: next }));
    };
    setState({ status: 'loading', text: null, error: null });
    try {
      const idempotencyKey = translationKeysRef.current[key] ?? (translationKeysRef.current[key] = await createIdempotencyKey());
      let translation = await requestArticleTranslation(articleId, request, idempotencyKey);
      while (translation.status === 'queued' || translation.status === 'generating') {
        await new Promise<void>((resolve) => setTimeout(resolve, translation.pollAfterMs ?? 1_000));
        translation = await getArticleTranslation(translation.id);
      }
      if (translation.status === 'failed' || !translation.translatedTextZh?.trim()) {
        // A terminal provider failure is reset by the next request. Do not
        // replay the old idempotency key, otherwise the server would return
        // the same failed translation forever instead of creating a retry.
        delete translationKeysRef.current[key];
        throw new ApiError(translation.failure?.code ?? 'TRANSLATION_FAILED', translation.failure?.message ?? '翻译暂时无法完成', translation.failure?.retryable ?? true);
      }
      setState({ status: 'ready', text: translation.translatedTextZh, error: null });
    } catch (error) {
      setState({ status: 'failed', text: null, error: messageFor(error) });
    }
  };

  if (loading) return <View style={[styles.centered, { backgroundColor: theme.bg }]}><ActivityIndicator color={theme.accent} /></View>;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回"><Ionicons name="chevron-back" size={26} color={theme.text} /></TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>文章阅读</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => void onToggleFavorite()}
            disabled={!article}
            hitSlop={8}
            accessibilityLabel={favorite ? '取消收藏' : '收藏文章'}
          >
            <Ionicons
              name={favorite ? 'star' : 'star-outline'}
              size={23}
              color={favorite ? theme.accent : theme.text}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/import')} hitSlop={8} accessibilityLabel="导入新文章"><Ionicons name="add" size={26} color={theme.text} /></TouchableOpacity>
        </View>
      </View>
      {article ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 34 }]} showsVerticalScrollIndicator={false}>
          <View style={[styles.sourcePill, { backgroundColor: theme.accentSoft }]}><Ionicons name="cloud-done-outline" size={14} color={theme.accent} /><Text style={[styles.sourcePillText, { color: theme.textSecondary }]}>{sourceLabel(article.sourceKind)} · 私人文章</Text></View>
          <Text style={[styles.title, { color: theme.text }]}>{article.title}</Text>
          <Text style={[styles.meta, { color: theme.textMuted }]}>{article.wordCount} 词 · {new Date(article.importedAt).toLocaleDateString('zh-CN')}</Text>

          <View style={[styles.fullTranslationBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.translationHeader}><View style={styles.translationHeading}><Ionicons name="language-outline" size={18} color={theme.blue} /><Text style={[styles.translationTitle, { color: theme.text }]}>全文翻译</Text></View><TouchableOpacity disabled={fullTranslation.status === 'loading'} onPress={() => void translate({ scope: 'full' }, 'full')} hitSlop={8}><Text style={[styles.translationAction, { color: theme.blue }]}>{fullTranslation.status === 'ready' ? '重新请求' : '查看译文'}</Text></TouchableOpacity></View>
            {fullTranslation.status === 'loading' ? <ActivityIndicator color={theme.blue} style={styles.translationSpinner} /> : null}
            {fullTranslation.status === 'ready' && fullTranslation.text ? <Text style={[styles.translationText, { color: theme.textSecondary }]}>{fullTranslation.text}</Text> : null}
            {fullTranslation.status === 'failed' ? <Text style={[styles.translationError, { color: theme.danger }]}>{fullTranslation.error}</Text> : null}
          </View>

          <View style={styles.articleBody}>
            {article.paragraphs.map((paragraph, index) => {
              const state = paragraphTranslations[paragraph.id] ?? INITIAL_TRANSLATION;
              return <ParagraphBlock key={paragraph.id} theme={theme} index={index} text={paragraph.text} translation={state} onTranslate={() => void translate({ scope: 'paragraph', paragraphId: paragraph.id }, `paragraph:${paragraph.id}`)} />;
            })}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.centered}><Ionicons name="alert-circle-outline" size={34} color={theme.danger} /><Text style={[styles.emptyTitle, { color: theme.text }]}>文章暂时无法读取</Text>{message ? <Text style={[styles.emptyMessage, { color: theme.danger }]}>{message}</Text> : null}</View>
      )}
    </View>
  );
}

function ParagraphBlock({ theme, index, text, translation, onTranslate }: { theme: Theme; index: number; text: string; translation: TranslationState; onTranslate: () => void }) {
  return <View style={styles.paragraphBlock}><View style={styles.paragraphHeader}><Text style={[styles.paragraphIndex, { color: theme.accent }]}>{String(index + 1).padStart(2, '0')}</Text><TouchableOpacity disabled={translation.status === 'loading'} onPress={onTranslate} hitSlop={8} style={styles.paragraphTranslationButton}><Ionicons name="language-outline" size={14} color={theme.blue} /><Text style={[styles.paragraphTranslationAction, { color: theme.blue }]}>{translation.status === 'ready' ? '刷新翻译' : '翻译本段'}</Text></TouchableOpacity></View><Text style={[styles.paragraphText, { color: theme.text }]}>{text}</Text>{translation.status === 'loading' ? <ActivityIndicator color={theme.blue} size="small" style={styles.paragraphSpinner} /> : null}{translation.status === 'ready' && translation.text ? <Text style={[styles.paragraphTranslation, { color: theme.textSecondary }]}>{translation.text}</Text> : null}{translation.status === 'failed' ? <Text style={[styles.translationError, { color: theme.danger }]}>{translation.error}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  content: { paddingHorizontal: 18, paddingTop: 12 },
  sourcePill: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 12, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 5 },
  sourcePillText: { fontSize: 11, fontWeight: weight('medium') },
  title: { fontSize: 27, fontWeight: weight('bold'), lineHeight: 35, marginTop: 14 },
  meta: { fontSize: 12, marginTop: 8 },
  fullTranslationBox: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 22, padding: 13 },
  translationHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  translationHeading: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  translationTitle: { fontSize: 14, fontWeight: weight('semibold') },
  translationAction: { fontSize: 12, fontWeight: weight('semibold') },
  translationSpinner: { marginTop: 13 },
  translationText: { fontSize: 14, lineHeight: 23, marginTop: 12 },
  translationError: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  articleBody: { marginTop: 24 },
  paragraphBlock: { marginBottom: 24 },
  paragraphHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  paragraphIndex: { fontSize: 12, fontWeight: weight('bold'), letterSpacing: 1 },
  paragraphTranslationButton: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  paragraphTranslationAction: { fontSize: 12, fontWeight: weight('medium') },
  paragraphText: { fontSize: 17, lineHeight: 29 },
  paragraphSpinner: { alignSelf: 'flex-start', marginTop: 9 },
  paragraphTranslation: { borderLeftWidth: 2, borderLeftColor: '#3B6FE0', fontSize: 14, lineHeight: 22, marginTop: 11, paddingLeft: 10 },
  emptyTitle: { fontSize: 18, fontWeight: weight('semibold'), marginTop: 12 },
  emptyMessage: { fontSize: 13, lineHeight: 20, marginTop: 8, textAlign: 'center' },
});
