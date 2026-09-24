import { useStudyTimer } from '@/features/study/useStudyTimer';
import { ReadingOverlayProvider, useReadingOverlay } from '@/features/practice/ReadingOverlay';
import { Ionicons } from '@expo/vector-icons';
import type {
  ImportedArticleDto,
  TranslationRequest,
  VocabularyInput,
} from '@context-reader/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { getImportedArticle } from '@/api/articles';
import {
  createVocabularyItem,
} from '@/api/practices';
import { useAppTheme } from '@/context/ThemeContext';
import type { Theme } from '@/constants/theme';
import { weight } from '@/constants/theme';
import { recordImportedRecentView } from '@/features/library/libraryStorage';
import {
  InteractiveWordParagraph,
} from '@/features/practice/ArticleParagraph';
import { isArticleSectionHeading } from '@/features/practice/articleTypography';
import { useTranslation } from '@/features/practice/useTranslation';
import { useSavedVocabularyWords } from '@/features/practice/useSavedVocabularyWords';

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '文章暂时无法读取';
}

function isMissingArticle(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NOT_FOUND';
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
  return <ReadingOverlayProvider><ArticleReadScreenContent /></ReadingOverlayProvider>;
}

function ArticleReadScreenContent() {
  const readingOverlay = useReadingOverlay();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const articleId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [article, setArticle] = useState<ImportedArticleDto | null>(null);
  const [loading, setLoading] = useState(Boolean(articleId));
  const [message, setMessage] = useState<string | null>(articleId ? null : '找不到文章');
  const [deleted, setDeleted] = useState(false);
  useStudyTimer(article !== null && !loading && !deleted);
  const { addedWords, handleWordAdded, error: highlightError, retry: retryHighlights } = useSavedVocabularyWords(articleId);

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
        }).catch(() => undefined);
      })
      .catch((error) => {
        if (!mounted) return;
        if (isMissingArticle(error)) setDeleted(true);
        else setMessage(messageFor(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [articleId]);

  const markDeleted = useCallback(() => setDeleted(true), []);

  if (loading) return <View style={[styles.centered, { backgroundColor: theme.bg }]}><ActivityIndicator color={theme.accent} /></View>;

  if (deleted) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <Ionicons name="trash-outline" size={34} color={theme.textMuted} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>文章已删除</Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => router.replace('/shelf' as never)}>
          <Text style={{ color: theme.blue }}>返回书架</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回"><Ionicons name="chevron-back" size={26} color={theme.text} /></TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>文章阅读</Text>
        <View style={styles.headerSpacer} />
      </View>
      {article ? (
        <ScrollView
          onScrollBeginDrag={() => readingOverlay?.select(null)}
          onScroll={(event) => readingOverlay?.onScroll(event.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 34 }]}
          showsVerticalScrollIndicator={false}>
          {highlightError && <TouchableOpacity accessibilityRole="button" onPress={retryHighlights}>
            <Text style={{ color: theme.danger }}>生词高亮加载失败，点击重试</Text>
          </TouchableOpacity>}
          <View style={[styles.sourcePill, { backgroundColor: theme.accentSoft }]}><Ionicons name="cloud-done-outline" size={14} color={theme.accent} /><Text style={[styles.sourcePillText, { color: theme.textSecondary }]}>{sourceLabel(article.sourceKind)} · 私人文章</Text></View>
          <Text style={[styles.title, { color: theme.text }]}>{article.title}</Text>
          <Text style={[styles.meta, { color: theme.textMuted }]}>{article.wordCount} 词 · {new Date(article.importedAt).toLocaleDateString('zh-CN')}</Text>

          <View style={[styles.fullTranslationBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ArticleTranslationControl
              articleId={article.id}
              actionLabel="查看译文"
              label="全文翻译"
              onMissingArticle={markDeleted}
              request={{ scope: 'full' }}
            />
          </View>

          <Text style={[styles.meta, { color: theme.textMuted }]}>点按单词查词 · 长按单词翻译整句</Text>
          <View style={styles.articleBody}>
            {article.paragraphs.map((paragraph, index) => (
              <ParagraphBlock
                articleId={article.id}
                key={paragraph.id}
                onMissingArticle={markDeleted}
                paragraphId={paragraph.id}
                theme={theme}
                index={index}
                text={paragraph.text}
                addedWords={addedWords}
                onWordAdded={handleWordAdded}
              />
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.centered}><Ionicons name="alert-circle-outline" size={34} color={theme.danger} /><Text style={[styles.emptyTitle, { color: theme.text }]}>文章暂时无法读取</Text>{message ? <Text style={[styles.emptyMessage, { color: theme.danger }]}>{message}</Text> : null}</View>
      )}
    </View>
  );
}

interface ArticleTranslationControlProps {
  articleId: string;
  request: TranslationRequest;
  label: string;
  actionLabel?: string;
  showLabel?: boolean;
  onMissingArticle: () => void;
}

function ArticleTranslationControl({
  articleId,
  request,
  label,
  actionLabel = label,
  showLabel = true,
  onMissingArticle,
}: ArticleTranslationControlProps) {
  const { theme } = useAppTheme();
  const translation = useTranslation(articleId, request, 'article');
  const loading = translation.status === 'loading';

  useEffect(() => {
    if (translation.error?.code === 'NOT_FOUND') onMissingArticle();
  }, [onMissingArticle, translation.error]);

  const buttonLabel = loading
    ? '翻译中…'
    : translation.visible
        ? '隐藏译文'
        : translation.error
          ? '重试翻译'
        : actionLabel;

  const handlePress = () => {
    if (translation.visible) translation.hide();
    else if (translation.error) void translation.retry();
    else void translation.show();
  };

  return (
    <View>
      <View style={styles.translationHeader}>
        <View style={styles.translationHeading}>
          <Ionicons name="language-outline" size={18} color={theme.blue} />
          {showLabel ? (
            <Text style={[styles.translationTitle, { color: theme.text }]}>
              {label}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={loading}
          hitSlop={8}
          onPress={handlePress}>
          {loading ? (
            <ActivityIndicator color={theme.blue} size="small" />
          ) : (
            <Text style={[styles.translationAction, { color: theme.blue }]}>
              {buttonLabel}
            </Text>
          )}
        </TouchableOpacity>
      </View>
      {translation.visible && translation.translatedTextZh ? (
        <Text style={[styles.translationText, { color: theme.textSecondary }]}>
          {translation.translatedTextZh}
        </Text>
      ) : null}
      {translation.error && translation.error.code !== 'NOT_FOUND' ? (
        <TouchableOpacity onPress={() => void translation.retry()}>
          <Text style={[styles.translationError, { color: theme.danger }]}>
            {translation.error.message} · 重试
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

interface ParagraphBlockProps {
  articleId: string;
  paragraphId: string;
  index: number;
  text: string;
  theme: Theme;
  onMissingArticle: () => void;
  addedWords: ReadonlySet<string>;
  onWordAdded: (term: string) => void;
}

function ParagraphBlock({
  articleId,
  paragraphId,
  index,
  text,
  theme,
  onMissingArticle,
  addedWords,
  onWordAdded,
}: ParagraphBlockProps) {
  const addToVocabulary = async (
    input: VocabularyInput,
    idempotencyKey: string,
  ) => {
    await createVocabularyItem(input, idempotencyKey);
  };

  return (
    <View style={styles.paragraphBlock}>
      <View style={styles.paragraphHeader}>
        <Text style={[styles.paragraphIndex, { color: theme.accent }]}>
          {String(index + 1).padStart(2, '0')}
        </Text>
        <ArticleTranslationControl
          articleId={articleId}
          label="翻译本段"
          onMissingArticle={onMissingArticle}
          request={{ scope: 'paragraph', paragraphId }}
          showLabel={false}
        />
      </View>
      <InteractiveWordParagraph
        isHeading={isArticleSectionHeading(text)}
        addedWords={addedWords}
        addedWordColor={theme.accent}
        borderColor={theme.border}
        dangerColor={theme.danger}
        onAddToVocabulary={addToVocabulary}
        surfaceColor={theme.surfaceAlt}
        targetColor={theme.accent}
        text={text}
        textColor={theme.text}
        onWordAdded={onWordAdded}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  headerSpacer: { width: 26 },
  content: { paddingHorizontal: 18, paddingTop: 12 },
  sourcePill: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 12, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 5 },
  sourcePillText: { fontSize: 11, fontWeight: weight('medium') },
  title: { fontSize: 32, fontWeight: weight('bold'), lineHeight: 41, marginTop: 14 },
  meta: { fontSize: 12, marginTop: 8 },
  fullTranslationBox: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 22, padding: 13 },
  translationHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  translationHeading: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  translationTitle: { fontSize: 14, fontWeight: weight('semibold') },
  translationAction: { fontSize: 12, fontWeight: weight('semibold') },
  translationText: { fontSize: 14, lineHeight: 23, marginTop: 12 },
  translationError: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  articleBody: { marginTop: 24 },
  paragraphBlock: { marginBottom: 24 },
  paragraphHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  paragraphIndex: { fontSize: 12, fontWeight: weight('bold'), letterSpacing: 1 },
  emptyTitle: { fontSize: 18, fontWeight: weight('semibold'), marginTop: 12 },
  emptyMessage: { fontSize: 13, lineHeight: 20, marginTop: 8, textAlign: 'center' },
});
