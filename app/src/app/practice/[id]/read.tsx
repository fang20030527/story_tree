import { useStudyTimer } from '@/features/study/useStudyTimer';
import { usePracticeExitGuard } from '@/features/practice/usePracticeExitGuard';
import { ReadingOverlayProvider, useReadingOverlay } from '@/features/practice/ReadingOverlay';
import { Ionicons } from '@expo/vector-icons';
import type { ArticleParagraph as ArticleParagraphDto, AssistanceResponse, PracticeDto, TranslationRequest, VocabularyInput } from '@context-reader/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { createVocabularyItem, getPractice, recordAssistance, requestWordTranslation } from '@/api/practices';
import { createIdempotencyKey } from '@/api/installation';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { InteractiveWordParagraph } from '@/features/practice/ArticleParagraph';
import { loadReadingPosition, saveReadingPosition } from '@/features/practice/practiceStorage';
import { useTranslation } from '@/features/practice/useTranslation';
import { useSavedVocabularyWords } from '@/features/practice/useSavedVocabularyWords';

const READER_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 35 };

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
  addedWords: ReadonlySet<string>;
  onWordAdded: (term: string) => void;
}

function PracticeParagraph({
  paragraph,
  practiceId,
  addedWords,
  onWordAdded,
}: PracticeParagraphProps) {
  const { theme } = useAppTheme();

  const hintKeys = useRef(new Map<string, Promise<string>>());
  const hintRecords = useRef(new Map<string, Promise<AssistanceResponse>>());
  const recordTargetLookup = (targetId: string): Promise<AssistanceResponse> => {
    const existing = hintRecords.current.get(targetId);
    if (existing) return existing;
    let key = hintKeys.current.get(targetId);
    if (!key) {
      key = createIdempotencyKey().catch((error: unknown) => {
        hintKeys.current.delete(targetId);
        throw error;
      });
      hintKeys.current.set(targetId, key);
    }
    const recording = key.then((idempotencyKey) =>
      recordAssistance(practiceId, { kind: 'word_hint', targetId }, idempotencyKey),
    ).catch((error: unknown) => {
      hintRecords.current.delete(targetId);
      throw error;
    });
    hintRecords.current.set(targetId, recording);
    return recording;
  };

  return (
    <View style={styles.paragraphBlock}>
      <InteractiveWordParagraph
        borderColor={theme.border}
        dangerColor={theme.danger}
        mutedColor={theme.textMuted}
        addedWords={addedWords}
        onWordAdded={onWordAdded}
        onAddToVocabulary={addPracticeVocabulary}
        lookupWord={(term, context) => requestWordTranslation({ term, context })}
        recordTargetLookup={recordTargetLookup}
        text={paragraph.segments.map((segment) => segment.text).join('')}
        segments={paragraph.segments}
        surfaceColor={theme.surfaceAlt}
        targetColor={theme.accent}
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

async function addPracticeVocabulary(input: VocabularyInput, idempotencyKey: string): Promise<void> {
  await createVocabularyItem(input, idempotencyKey);
}

function ReaderContent({ practiceId }: { practiceId: string }) {
  const readingOverlay = useReadingOverlay();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [practice, setPractice] = useState<PracticeDto | null>(null);
  useStudyTimer(Boolean(practice?.article));
  const allowNavigation = usePracticeExitGuard(practiceId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const listRef = useRef<FlatList<ArticleParagraphDto>>(null);
  const [initialIndex, setInitialIndex] = useState(0);
  const lastSavedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([getPractice(practiceId), loadReadingPosition(practiceId).catch(() => 0)])
      .then(([nextPractice, savedIndex]) => {
        if (!mounted) return;
        if (
          nextPractice.status === 'queued'
          || nextPractice.status === 'generating'
          || nextPractice.status === 'validating'
          || nextPractice.status === 'failed'
        ) {
          allowNavigation(() => router.replace({
            pathname: '/practice/[id]/generating',
            params: { id: practiceId },
          }));
          return;
        }
        if (!nextPractice.article) {
          setLoadError('服务返回了无法识别的文章数据');
          return;
        }
        setInitialIndex(Math.min(savedIndex, Math.max(0, nextPractice.article.paragraphs.length - 1)));
        setPractice(nextPractice);
      })
      .catch((error: unknown) => {
        if (mounted) setLoadError(safeLoadMessage(error));
      });
    return () => {
      mounted = false;
    };
  }, [allowNavigation, loadAttempt, practiceId]);

  const { addedWords, handleWordAdded, error: highlightError, retry: retryHighlights } = useSavedVocabularyWords(practiceId);

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
      addedWords={addedWords}
      onWordAdded={handleWordAdded}
    />
  ), [practiceId, addedWords, handleWordAdded]);

  if (!practice && !loadError) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <ActivityIndicator accessibilityLabel="正在加载文章" color={theme.accent} />
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
          onPress={() => practice.group
            ? router.replace({ pathname: '/practice/[id]/topics', params: { id: practice.group.id } })
            : router.back()}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>长文练习</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        ref={listRef}
        initialScrollIndex={initialIndex}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
        }}
        onScrollBeginDrag={() => readingOverlay?.select(null)}
        onScroll={(event) => readingOverlay?.onScroll(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        testID="practice-reader-list"
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
              {practice.status === 'completed' ? '回看自测' : '开始自测'}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={theme.accentText} />
          </TouchableOpacity>
        )}
        ListHeaderComponent={(
          <View style={styles.articleHeader}>
            {highlightError && <TouchableOpacity accessibilityRole="button" onPress={retryHighlights}>
              <Text style={[styles.loadError, { color: theme.danger }]}>生词高亮加载失败，点击重试</Text>
            </TouchableOpacity>}
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
        viewabilityConfig={READER_VIEWABILITY_CONFIG}
      />
    </View>
  );
}

export default function PracticeReaderScreen() {
  return <ReadingOverlayProvider><PracticeReaderScreenContent /></ReadingOverlayProvider>;
}

function PracticeReaderScreenContent() {
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
  return <ReaderContent key={practiceId} practiceId={practiceId} />;
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
