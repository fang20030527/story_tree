import { useStudyTimer } from '@/features/study/useStudyTimer';
import { ApiError } from '@/api/client';
import { EditorialAudioPlayer, type EditorialPlaybackPosition } from './EditorialAudioPlayer';
import { findAudioCue } from './editorialAudioSync';
import { ReadingOverlayProvider, useReadingOverlay } from '@/features/practice/ReadingOverlay';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { VocabularyInput } from '@context-reader/contracts';

import { createVocabularyItem, requestWordTranslation } from '@/api/practices';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import type { EditorialArticle } from '@/features/editorial/catalog';
import { recordEditorialRecentView } from '@/features/library/libraryStorage';
import { InteractiveWordParagraph } from '@/features/practice/ArticleParagraph';
import { EditorialImage } from './EditorialImage';
import { EditorialRemoteStatus } from './EditorialRemoteStatus';
import { EditorialSpeechPlayer } from './EditorialSpeechPlayer';
import { useEditorialArticle } from './useEditorialArticle';
import {
  loadEditorialTranslation,
  requestEditorialTranslation,
  saveEditorialTranslation,
} from './editorialTranslation';
import { markEditorialArticleRead } from './editorialReadStorage';
import { saveEditorialReadingProgress } from './editorialReadingProgress';
import { useEditorialReadingProgress } from './useEditorialReadingProgress';

type Props = { articleId: string };

export function EditorialReadScreen({ articleId }: Props) {
  const { article, loading, error, retry } = useEditorialArticle(articleId);
  return article ? (
    <ReadingOverlayProvider><EditorialReadContent key={article.id} article={article} /></ReadingOverlayProvider>
  ) : loading || error ? (
    <EditorialRemoteStatus loading={loading} retry={retry} />
  ) : (
    <MissingEditorialArticleState />
  );
}

function EditorialReadContent({ article }: { article: EditorialArticle }) {
  useStudyTimer(true);
  const readingOverlay = useReadingOverlay();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const {
    addedWords, showFullTranslation, error: progressError, retry,
    scrollRef, onLayout, onContentSizeChange, onScroll, flush,
    toggleTranslation, wordAdded, onUserScrollStart,
  } = useEditorialReadingProgress(article.id);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [fullTranslation, setFullTranslation] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{ completed: number; total: number } | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const translationInFlight = useRef(false);
  const translationMounted = useRef(true);
  useEffect(() => {
    translationMounted.current = true;
    return () => { translationMounted.current = false; };
  }, []);
  const loadTranslation = useCallback(async () => {
    if (translationInFlight.current || fullTranslation) return;
    translationInFlight.current = true;
    setTranslationLoading(true);
    setTranslationProgress(null);
    setTranslationError(null);
    try {
      let translated = await loadEditorialTranslation(article.id, article.paragraphs)
        .catch(() => null);
      if (!translated) {
        translated = await requestEditorialTranslation(article.paragraphs, (completed, total) => {
          if (translationMounted.current) setTranslationProgress({ completed, total });
        });
        void saveEditorialTranslation(article.id, article.paragraphs, translated)
          .catch(() => undefined);
      }
      if (translationMounted.current) setFullTranslation(translated);
    } catch (reason) {
      if (translationMounted.current) setTranslationError(
        reason instanceof ApiError ? reason.message : '译文生成失败，请重试',
      );
    } finally {
      translationInFlight.current = false;
      if (translationMounted.current) setTranslationLoading(false);
    }
  }, [article.id, article.paragraphs, fullTranslation]);
  useEffect(() => {
    if (showFullTranslation && !fullTranslation && !translationLoading && !translationError) {
      const timer = setTimeout(() => { void loadTranslation(); }, 0);
      return () => clearTimeout(timer);
    }
  }, [showFullTranslation, fullTranslation, translationLoading, translationError, loadTranslation]);
  const [playback, setPlayback] = useState<EditorialPlaybackPosition>({ currentTime: 0, duration: 0, playing: false });
  const updatePlayback = useCallback((position: EditorialPlaybackPosition) => {
    // 进度条高频刷新，正文只在朗读词或播放状态改变时更新。
    setPlayback((previous) => previous.playing === position.playing
      && findAudioCue(article.audioCues ?? [], previous.currentTime) === findAudioCue(article.audioCues ?? [], position.currentTime)
      ? previous : position);
  }, [article.audioCues]);
  const [following, setFollowing] = useState(true);
  const [bodyY, setBodyY] = useState(0);
  const [paragraphLayouts, setParagraphLayouts] = useState<Record<number, number>>({});
  const [lineLayouts, setLineLayouts] = useState<Record<number, { start: number; end: number; y: number; height: number }[]>>({});
  const viewport = useRef({ y: 0, height: 0 });
  const audioHeight = useRef(170);
  const cue = findAudioCue(article.audioCues ?? [], playback.currentTime);
  const cueParagraph = cue?.[0];
  const cueStart = cue?.[1];
  useEffect(() => {
    if (!following || readingOverlay?.activeId || cueParagraph === undefined || cueStart === undefined) return;
    const paragraphY = paragraphLayouts[cueParagraph];
    const line = lineLayouts[cueParagraph]?.find((item) => cueStart >= item.start && cueStart < item.end);
    if (paragraphY === undefined || !line || !viewport.current.height) return;
    const y = bodyY + paragraphY + line.y;
    const top = viewport.current.y + audioHeight.current + 16;
    const bottom = viewport.current.y + viewport.current.height - 48;
    if (y < top || y + line.height > bottom) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - audioHeight.current - 28), animated: true });
    }
  }, [following, playback.playing, readingOverlay?.activeId, cueParagraph, cueStart, bodyY, paragraphLayouts, lineLayouts, scrollRef]);
  const completeLearning = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setCompletionError(null);
    readingOverlay?.select(null);
    try {
      await markEditorialArticleRead(article.id);
    } catch {
      savingRef.current = false;
      setSaving(false);
      setCompletionError('已读状态保存失败，请重试');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const body = useMemo(() => {
    let paragraphIndex = 0;
    return (article.bodyBlocks ?? article.paragraphs.map((text) => ({ type: 'text' as const, text })))
      .map((block) => block.type === 'text' ? { ...block, paragraphIndex: paragraphIndex++ } : block);
  }, [article.bodyBlocks, article.paragraphs]);
  const [visibleBlockCount, setVisibleBlockCount] = useState(() => body.length <= 64 ? body.length : 8);
  const bodyComplete = visibleBlockCount >= body.length;
  useEffect(() => {
    if (bodyComplete) return;
    const timer = setTimeout(() => {
      setVisibleBlockCount((count) => Math.min(count + 8, body.length));
    }, 24);
    return () => clearTimeout(timer);
  }, [bodyComplete, visibleBlockCount, body.length]);
  const addVocabulary = async (input: VocabularyInput, idempotencyKey: string) => {
    await addEditorialVocabulary(input, idempotencyKey);
    // 请求完成时页面可能已经卸载，仍须保存高亮。
    await saveEditorialReadingProgress(article.id, { addedWords: [input.term] });
  };

  useEffect(() => {
    void recordEditorialRecentView(article.id).catch(() => undefined);
  }, [article.id]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>平台外刊</Text>
        <View style={styles.headerSpacer} />
      </View>
      {progressError ? (
        <TouchableOpacity accessibilityRole="button" onPress={retry}>
          <Text style={{ color: theme.danger, padding: 16 }}>{progressError}</Text>
        </TouchableOpacity>
      ) : null}
      <ScrollView
        ref={scrollRef}
        testID="editorial-reading-scroll"
        onLayout={(event) => { viewport.current.height = event.nativeEvent.layout.height; onLayout(event.nativeEvent.layout.height); }}
        onContentSizeChange={(_, height) => { if (bodyComplete) onContentSizeChange(height); }}
        onScroll={(event) => {
          viewport.current.y = event.nativeEvent.contentOffset.y;
          readingOverlay?.onScroll(event.nativeEvent.contentOffset.y);
          onScroll(event);
        }}
        stickyHeaderIndices={article.audioAsset || article.audioUrl || article.wordCount > 0 ? [4] : undefined}
        scrollEventThrottle={16}
        onScrollEndDrag={(event) => { onScroll(event); flush(); }}
        onMomentumScrollEnd={(event) => { onScroll(event); flush(); }}
        onScrollBeginDrag={() => { onUserScrollStart(); readingOverlay?.select(null); setFollowing(false); }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}>
        <Text style={[styles.kicker, { color: theme.accent }]}>
          {article.source} · {article.category}
        </Text>
        <Text selectable style={[styles.titleEn, { color: theme.text }]}>
          {article.titleEn}
        </Text>
        {article.titleZh !== article.titleEn ? (
          <Text style={[styles.titleZh, { color: theme.textSecondary }]}>
            {article.titleZh}
          </Text>
        ) : null}
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {article.wordCount} 词 · {article.minutes} 分钟 · {article.level}
        </Text>
        {article.audioAsset || article.audioUrl ? (
          <View onLayout={(event) => { audioHeight.current = event.nativeEvent.layout.height; }} style={{ backgroundColor: theme.bg }}>
            <EditorialAudioPlayer source={article.audioUrl ?? article.audioAsset!} onPositionChange={updatePlayback} />
          </View>
        ) : article.wordCount > 0 ? (
          <View style={{ backgroundColor: theme.bg }}>
            <EditorialSpeechPlayer loadText={() => article.paragraphs} />
          </View>
        ) : null}
        <View
          style={[
            styles.translationBox,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}>
          <View style={styles.translationHeader}>
            <View style={styles.translationHeading}>
              <Ionicons name="language-outline" size={18} color={theme.blue} />
              <Text style={[styles.translationTitle, { color: theme.text }]}>全文翻译</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ expanded: showFullTranslation }}
              hitSlop={8}
              onPress={toggleTranslation}>
              <Text style={[styles.translationAction, { color: theme.blue }]}>
                {showFullTranslation ? '隐藏译文' : '查看译文'}
              </Text>
            </TouchableOpacity>
          </View>
          {showFullTranslation && fullTranslation ? (
            <Text style={[styles.translationText, { color: theme.textSecondary }]}>
              {fullTranslation}
            </Text>
          ) : null}
          {showFullTranslation && translationLoading ? (
            <Text style={[styles.translationText, { color: theme.textMuted }]}>
              {translationProgress
                ? `正在生成译文… ${translationProgress.completed}/${translationProgress.total}`
                : '正在生成译文…'}
            </Text>
          ) : null}
          {showFullTranslation && translationError ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => void loadTranslation()}>
              <Text style={[styles.translationText, { color: theme.danger }]}>{translationError} · 重试</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View testID="editorial-body" style={styles.body} onLayout={(event) => setBodyY(event.nativeEvent.layout.y)}>
          {body.slice(0, visibleBlockCount).map((block, blockIndex) => {
            if (block.type === 'image') return (
              <EditorialImage key={`${article.id}:image:${blockIndex}`} uri={block.image} contentFit="contain"
                priority="low"
                accessibilityLabel={`${article.titleEn}，原刊配图 ${blockIndex + 1}`}
                style={{ width: '100%', aspectRatio: block.width / block.height }} />
            );
            const paragraph = block.text;
            const index = block.paragraphIndex;
            return (
            <View testID={`editorial-paragraph-${index}`} key={`${article.id}:${index}`} onLayout={(event) => {
              const y = event.nativeEvent.layout.y;
              setParagraphLayouts((current) => current[index] === y ? current : { ...current, [index]: y });
            }}>
              <InteractiveWordParagraph
                playbackRange={cueParagraph === index && cue ? { start: cue[1], end: cue[2], color: theme.blue } : undefined}
                onTextLayout={(event) => {
                  let cursor = 0;
                  const lines = event.nativeEvent.lines.map((line) => {
                    const start = paragraph.indexOf(line.text, cursor);
                    const offset = start < 0 ? cursor : start;
                    cursor = offset + line.text.length;
                    return { start: offset, end: cursor, y: line.y, height: line.height };
                  });
                  setLineLayouts((current) => JSON.stringify(current[index]) === JSON.stringify(lines) ? current : { ...current, [index]: lines });
                }}
                isHeading={article.sectionHeadings?.includes(paragraph)}
                addedWords={addedWords}
                addedWordColor={theme.accent}
                borderColor={theme.border}
                dangerColor={theme.danger}
                lookupWord={lookupEditorialWord}
                onAddToVocabulary={addVocabulary}
                onWordAdded={wordAdded}
                surfaceColor={theme.surfaceAlt}
                targetColor={theme.accent}
                text={paragraph}
                textColor={theme.text}
              />
              {article.figures?.filter((figure) => figure.afterParagraph === index).map((figure) => (
                <View key={figure.caption}>
                  <EditorialImage uri={figure.image} style={{ width: '100%', aspectRatio: 976 / 549, borderRadius: 12 }} />
                  <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18, marginTop: 8 }}>{figure.caption}</Text>
                </View>
              ))}
            </View>
            );
          })}
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="完成学习"
          accessibilityState={{ disabled: saving, busy: saving }}
          disabled={saving}
          onPress={() => void completeLearning()}
          style={[styles.completeButton, { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={[styles.completeButtonText, { color: theme.accentText }]}>
            {saving ? '保存中…' : '完成学习'}
          </Text>
        </TouchableOpacity>
        {completionError ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, marginTop: 12 }}>
            {completionError}
          </Text>
        ) : null}
      </ScrollView>
      {!following && playback.playing && article.audioCues?.length ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="恢复跟随朗读"
          onPress={() => setFollowing(true)}
          style={{ position: 'absolute', bottom: insets.bottom + 16, alignSelf: 'center', backgroundColor: theme.surface, borderColor: theme.blue, borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 12 }}>
          <Text style={{ color: theme.blue }}>恢复跟随朗读</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

async function lookupEditorialWord(term: string, context: string) {
  const response = await requestWordTranslation({ term, context });
  return response;
}

async function addEditorialVocabulary(
  input: VocabularyInput,
  idempotencyKey: string,
): Promise<void> {
  await createVocabularyItem(input, idempotencyKey);
}

function MissingEditorialArticleState() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>平台外刊</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.missing}>
        <Text style={[styles.missingTitle, { color: theme.text }]}>文章不存在</Text>
        <TouchableOpacity
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          accessibilityLabel="返回外刊">
          <Text style={{ color: theme.blue }}>返回外刊</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  headerSpacer: { width: 26 },
  content: { paddingHorizontal: 18, paddingTop: 16 },
  kicker: { fontSize: 12, fontWeight: weight('semibold') },
  titleEn: { fontSize: 32, fontWeight: weight('bold'), lineHeight: 41, marginTop: 12 },
  titleZh: { fontSize: 16, lineHeight: 24, marginTop: 10 },
  meta: { fontSize: 12, marginTop: 10 },
  translationBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 22,
    padding: 13,
  },
  translationHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  translationHeading: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  translationTitle: { fontSize: 14, fontWeight: weight('semibold') },
  translationAction: { fontSize: 12, fontWeight: weight('semibold') },
  translationText: { fontSize: 14, lineHeight: 23, marginTop: 12 },
  body: { gap: 22, marginTop: 28 },
  completeButton: { alignItems: 'center', borderRadius: 13, marginTop: 32, paddingVertical: 16 },
  completeButtonText: { fontSize: 16, fontWeight: weight('semibold') },
  paragraph: { fontSize: 17, lineHeight: 30 },
  missing: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center' },
  missingTitle: { fontSize: 18, fontWeight: weight('semibold') },
});
