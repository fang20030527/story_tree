import { Ionicons } from '@expo/vector-icons';
import type { ArticleParagraph as ArticleParagraphDto, PracticeDto, TranslationRequest } from '@context-reader/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { getPractice } from '@/api/practices';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { InteractiveArticleParagraph } from '@/features/practice/ArticleParagraph';
import { saveReadingPosition } from '@/features/practice/practiceStorage';
import { useTranslation } from '@/features/practice/useTranslation';

function safeLoadMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '暂时无法加载这篇练习';
}

interface TranslationControlProps {
  practiceId: string;
  request: TranslationRequest;
  label: string;
}

function TranslationControl({
  practiceId,
  request,
  label,
}: TranslationControlProps) {
  const { theme } = useAppTheme();
  const translation = useTranslation(practiceId, request);
  const loading = translation.status === 'loading';
  const buttonLabel = loading
    ? '翻译中…'
    : translation.visible
      ? '收起译文'
      : translation.status === 'failed'
        ? '重试翻译'
        : label;

  const handlePress = () => {
    if (translation.visible) {
      translation.hide();
      return;
    }
    if (translation.error) void translation.retry();
    else void translation.show();
  };

  return (
    <View style={styles.translationArea}>
      <TouchableOpacity
        disabled={loading}
        onPress={handlePress}
        style={[
          styles.translationButton,
          {
            backgroundColor: theme.surfaceAlt,
            borderColor: theme.border,
            opacity: loading ? 0.65 : 1,
          },
        ]}>
        {loading ? (
          <ActivityIndicator color={theme.blue} size="small" />
        ) : (
          <Ionicons
            name={translation.visible ? 'chevron-up' : 'language-outline'}
            size={16}
            color={theme.blue}
          />
        )}
        <Text style={[styles.translationButtonText, { color: theme.blue }]}>
          {buttonLabel}
        </Text>
      </TouchableOpacity>

      {translation.visible && translation.translatedTextZh ? (
        <View
          style={[
            styles.translationCard,
            { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}>
          <Text style={[styles.translationText, { color: theme.textSecondary }]}>
            {translation.translatedTextZh}
          </Text>
        </View>
      ) : null}

      {translation.error ? (
        <TouchableOpacity onPress={() => void translation.retry()}>
          <Text style={[styles.translationError, { color: theme.danger }]}>
            {translation.error.message} · 重试
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

interface PracticeParagraphProps {
  paragraph: ArticleParagraphDto;
  practiceId: string;
  targetTerms: Record<string, string>;
}

function PracticeParagraph({
  paragraph,
  practiceId,
  targetTerms,
}: PracticeParagraphProps) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.paragraphBlock}>
      <InteractiveArticleParagraph
        borderColor={theme.border}
        dangerColor={theme.danger}
        mutedColor={theme.textMuted}
        practiceId={practiceId}
        segments={paragraph.segments}
        surfaceColor={theme.surfaceAlt}
        targetColor={theme.accent}
        targetTerms={targetTerms}
        textColor={theme.text}
      />
      <TranslationControl
        label="翻译本段"
        practiceId={practiceId}
        request={{ scope: 'paragraph', paragraphId: paragraph.id }}
      />
    </View>
  );
}

function ReaderContent({ practiceId }: { practiceId: string }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [practice, setPractice] = useState<PracticeDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const lastSavedIndexRef = useRef<number | null>(null);
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 35 }), []);

  useEffect(() => {
    let mounted = true;
    getPractice(practiceId)
      .then((nextPractice) => {
        if (!mounted) return;
        if (
          nextPractice.status === 'queued'
          || nextPractice.status === 'generating'
          || nextPractice.status === 'validating'
          || nextPractice.status === 'failed'
        ) {
          router.replace({
            pathname: '/practice/[id]/generating',
            params: { id: practiceId },
          });
          return;
        }
        if (!nextPractice.article) {
          setLoadError('服务返回了无法识别的文章数据');
          return;
        }
        setPractice(nextPractice);
      })
      .catch((error: unknown) => {
        if (mounted) setLoadError(safeLoadMessage(error));
      });
    return () => {
      mounted = false;
    };
  }, [loadAttempt, practiceId]);

  const targetTerms = useMemo(
    () => practice?.questions.reduce<Record<string, string>>(
      (terms, question) => {
        terms[question.targetId] = question.term;
        return terms;
      },
      {},
    ) ?? {},
    [practice?.questions],
  );

  const onViewableItemsChanged = useCallback((info: {
    viewableItems: ViewToken<ArticleParagraphDto>[];
  }) => {
    const visibleIndex = info.viewableItems
      .map((item) => item.index)
      .find((index): index is number => index !== null);
    if (visibleIndex === undefined || visibleIndex === lastSavedIndexRef.current) {
      return;
    }
    lastSavedIndexRef.current = visibleIndex;
    void saveReadingPosition(practiceId, visibleIndex).catch(
      () => undefined,
    );
  }, [practiceId]);

  const renderParagraph = useCallback(({ item }: {
    item: ArticleParagraphDto;
  }) => (
    <PracticeParagraph
      paragraph={item}
      practiceId={practiceId}
      targetTerms={targetTerms}
    />
  ), [practiceId, targetTerms]);

  if (!practice && !loadError) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!practice || !practice.article) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <Text style={[styles.loadError, { color: theme.danger }]}>
          {loadError ?? '暂时无法加载这篇练习'}
        </Text>
        <TouchableOpacity
          onPress={() => {
            setLoadError(null);
            setLoadAttempt((attempt) => attempt + 1);
          }}
          style={[styles.retryButton, { borderColor: theme.border }]}>
          <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity
          accessibilityLabel="返回"
          hitSlop={8}
          onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>长文练习</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        data={practice.article.paragraphs}
        keyExtractor={(paragraph) => paragraph.id}
        ListFooterComponent={(
          <TouchableOpacity
            onPress={() => router.push({
              pathname: '/practice/[id]/quiz',
              params: { id: practiceId },
            })}
            style={[styles.quizButton, { backgroundColor: theme.accent }]}>
            <Text style={[styles.quizButtonText, { color: theme.accentText }]}>
              开始词义测验
            </Text>
            <Ionicons name="arrow-forward" size={18} color={theme.accentText} />
          </TouchableOpacity>
        )}
        ListHeaderComponent={(
          <View style={styles.articleHeader}>
            <Text style={[styles.articleTitle, { color: theme.text }]}>
              {practice.article.title}
            </Text>
            <Text style={[styles.wordCount, { color: theme.textMuted }]}>
              {practice.article.wordCount} 词
            </Text>
            <TranslationControl
              label="全文翻译"
              practiceId={practiceId}
              request={{ scope: 'full' }}
            />
          </View>
        )}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={renderParagraph}
        showsVerticalScrollIndicator={false}
        viewabilityConfig={viewabilityConfig}
      />
    </View>
  );
}

export default function PracticeReaderScreen() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const practiceId = typeof id === 'string' ? id : null;

  if (!practiceId) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <Text style={[styles.loadError, { color: theme.danger }]}>练习地址无效</Text>
      </View>
    );
  }
  return <ReaderContent practiceId={practiceId} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: weight('semibold'),
    textAlign: 'center',
  },
  headerSpacer: { width: 26 },
  listContent: { paddingHorizontal: 18 },
  articleHeader: { paddingBottom: 24, paddingTop: 16 },
  articleTitle: { fontSize: 27, fontWeight: weight('bold'), lineHeight: 36 },
  wordCount: { fontSize: 13, marginTop: 8 },
  paragraphBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    marginBottom: 22,
  },
  translationArea: { alignItems: 'flex-start' },
  translationButton: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  translationButtonText: { fontSize: 13, fontWeight: weight('medium') },
  translationCard: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    padding: 12,
    width: '100%',
  },
  translationText: { fontSize: 15, lineHeight: 25 },
  translationError: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  quizButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  quizButtonText: { fontSize: 16, fontWeight: weight('bold') },
  loadError: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  retryButton: {
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  retryText: { fontSize: 14, fontWeight: weight('semibold') },
});
