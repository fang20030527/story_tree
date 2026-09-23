import type {
  AssistanceResponse,
  ArticleSegment,
  VocabularyInput,
  WordTranslationResult,
} from '@context-reader/contracts';
import { abbreviatePartOfSpeech } from '@context-reader/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type TextLayoutLine,
  type TextProps,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import {
  recordAssistance,
  requestWordTranslation,
} from '@/api/practices';

import { ReadingOverlay, useReadingOverlay, type WordAnchor } from './ReadingOverlay';

import { SentenceTranslation } from './SentenceTranslation';

import { WordPronunciation } from './WordPronunciation';

interface ArticleParagraphProps {
  segments: ArticleSegment[];
  targetColor: string;
  textColor?: string;
  onTargetPress: (targetId: string) => void;
}

export function ArticleParagraph({
  segments,
  textColor,
  onTargetPress,
}: ArticleParagraphProps) {
  return (
    <Text style={[styles.paragraph, textColor ? { color: textColor } : undefined]}>
      {segments.map((segment, index) => {
        const targetId = segment.targetId;
        return (
          <Text
            key={`${index}-${targetId ?? 'plain'}`}
            onPress={targetId ? () => onTargetPress(targetId) : undefined}>
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
}

interface InteractiveArticleParagraphProps
  extends Omit<ArticleParagraphProps, 'onTargetPress'> {
  practiceId: string;
  targetTerms: Record<string, string>;
  surfaceColor?: string;
  borderColor?: string;
  textColor?: string;
  mutedColor?: string;
  dangerColor?: string;
}

interface VisibleHint {
  targetId: string;
  meaningZh: string | null;
  loading: boolean;
  error: string | null;
  sourceSentence?: string | null;
}

function safeHintError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return '暂时无法显示这个词义';
}

export function InteractiveArticleParagraph({
  practiceId,
  segments,
  targetColor,
  targetTerms,
  surfaceColor = '#f5f5f5',
  borderColor = '#dedede',
  textColor = '#171717',
  mutedColor = '#666666',
  dangerColor = '#dc2626',
}: InteractiveArticleParagraphProps) {
  const [visibleHint, setVisibleHint] = useState<VisibleHint | null>(null);
  const mountedRef = useRef(true);
  const keyPromisesRef = useRef<Map<string, Promise<string>>>(new Map());
  const meaningsRef = useRef<Map<string, AssistanceResponse>>(new Map());
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const keyForTarget = (targetId: string): Promise<string> => {
    const existing = keyPromisesRef.current.get(targetId);
    if (existing) return existing;

    const created = createIdempotencyKey().catch((error) => {
      keyPromisesRef.current.delete(targetId);
      throw error;
    });
    keyPromisesRef.current.set(targetId, created);
    return created;
  };

  const showHint = async (targetId: string) => {
    const requestId = ++requestIdRef.current;
    const cached = meaningsRef.current.get(targetId);
    if (cached) {
      setVisibleHint({
        targetId,
        meaningZh: cached.hintMeaningZh,
        sourceSentence: cached.sourceSentence,
        loading: false,
        error: null,
      });
      return;
    }

    setVisibleHint({ targetId, meaningZh: null, loading: true, error: null });
    try {
      const idempotencyKey = await keyForTarget(targetId);
      const response = await recordAssistance(
        practiceId,
        { kind: 'word_hint', targetId },
        idempotencyKey,
      );
      if (!response.hintMeaningZh) {
        throw new ApiError(
          'INVALID_SERVER_RESPONSE',
          '服务返回了无法识别的数据',
          true,
        );
      }
      meaningsRef.current.set(targetId, response);
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setVisibleHint({
        targetId,
        meaningZh: response.hintMeaningZh,
        sourceSentence: response.sourceSentence,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        keyPromisesRef.current.delete(targetId);
      }
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setVisibleHint({
        targetId,
        meaningZh: null,
        loading: false,
        error: safeHintError(error),
      });
    }
  };

  return (
    <View>
      <ArticleParagraph
        onTargetPress={(targetId) => void showHint(targetId)}
        segments={segments}
        targetColor={targetColor}
        textColor={textColor}
      />
      {visibleHint ? (
        <View
          style={[
            styles.hint,
            { backgroundColor: surfaceColor, borderColor },
          ]}>
          <View style={styles.hintHeader}>
            <Text style={[styles.hintTerm, { color: textColor }]}>
              {targetTerms[visibleHint.targetId] ?? '词义提示'}
            </Text>
            <TouchableOpacity
              accessibilityLabel="关闭词义提示"
              hitSlop={8}
              onPress={() => {
                requestIdRef.current += 1;
                setVisibleHint(null);
              }}>
              <Text style={[styles.hintClose, { color: mutedColor }]}>×</Text>
            </TouchableOpacity>
          </View>
          {visibleHint.loading ? (
            <ActivityIndicator color={targetColor} size="small" />
          ) : null}
          {visibleHint.meaningZh ? (
            <PracticeWordDetails
              key={visibleHint.targetId}
              term={targetTerms[visibleHint.targetId]
                ?? segments.find((segment) => segment.targetId === visibleHint.targetId)?.text ?? ''}
              context={contextForWord(
                segments.map((segment) => segment.text).join(''),
                targetTerms[visibleHint.targetId] ?? '',
                segments.slice(0, segments.findIndex((segment) => segment.targetId === visibleHint.targetId))
                  .reduce((length, segment) => length + segment.text.length, 0),
              )}
              textColor={textColor}
            />
          ) : null}
          {visibleHint.meaningZh ? (
            <Text style={[styles.hintMeaning, { color: textColor }]}>
              {visibleHint.meaningZh}
            </Text>
          ) : null}
          {visibleHint.meaningZh ? (
            <SavedWordContext sentence={visibleHint.sourceSentence} color={textColor} showMissing />
          ) : null}
          {visibleHint.error ? (
            <TouchableOpacity onPress={() => void showHint(visibleHint.targetId)}>
              <Text style={[styles.hintError, { color: dangerColor }]}>
                {visibleHint.error} · 重试
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SavedWordContext({ sentence, color = '#000000', showMissing = false }: {
  sentence?: string | null;
  color?: string;
  showMissing?: boolean;
}) {
  if (!sentence && !showMissing) return null;
  return (
    <View style={styles.savedContext}>
      <Text style={[styles.contextLabel, { color }]}>例句（收藏时的原句）</Text>
      <Text selectable style={[styles.contextSentence, { color }]}>
        {sentence || '这个词加入生词本时未保存原句'}
      </Text>
    </View>
  );
}

/** Dictionary availability must never hide an already recorded hint or its source. */
function PracticeWordDetails({ term, context, textColor }: {
  term: string;
  context: string;
  textColor: string;
}) {
  const [lookup, setLookup] = useState<WordTranslationResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    requestWordTranslation({ term, context }).then((result) => {
      if (active) setLookup(result);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [term, context, attempt]);
  return (
    <View>
      <WordPronunciation
        term={term}
        phoneticUk={lookup?.phoneticUk}
        phoneticUs={lookup?.phoneticUs}
        color={textColor}
      />
      {lookup ? (
        <Text style={[styles.hintPartOfSpeech, { color: textColor }]}>{abbreviatePartOfSpeech(lookup.partOfSpeech)}</Text>
      ) : failed ? (
        <TouchableOpacity onPress={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}>
          <Text style={[styles.hintError, { color: textColor }]}>音标和词性加载失败 · 重试</Text>
        </TouchableOpacity>
      ) : <ActivityIndicator size="small" color={textColor} />}
    </View>
  );
}

export interface ArticleTextToken {
  text: string;
  isWord: boolean;
  key: string;
}

const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+|-[A-Za-z]+)*/gu;

/** Split prose without changing its whitespace or punctuation. */
export function tokenizeArticleText(text: string): ArticleTextToken[] {
  const tokens: ArticleTextToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(ENGLISH_WORD_PATTERN)) {
    const index = match.index ?? cursor;
    if (index > cursor) {
      tokens.push({
        text: text.slice(cursor, index),
        isWord: false,
        key: `${cursor}:plain`,
      });
    }
    const word = match[0] ?? '';
    if (word) {
      tokens.push({ text: word, isWord: true, key: `${index}:word` });
    }
    cursor = index + word.length;
  }
  if (cursor < text.length) {
    tokens.push({
      text: text.slice(cursor),
      isWord: false,
      key: `${cursor}:plain`,
    });
  }
  return tokens;
}

interface ClickableArticleParagraphProps {
  textStyle?: TextProps["style"];
  isHeading?: boolean;
  playbackRange?: { start: number; end: number; color: string };
  onTextLayout?: TextProps["onTextLayout"];
  text: string;
  segments?: ArticleSegment[];
  targetColor: string;
  textColor?: string;
  addedWords?: ReadonlySet<string>;
  addedWordColor?: string;
  onSentenceLongPress?: (sentence: string, anchor: WordAnchor) => void;
  onSentenceAnchorChange?: (anchor: WordAnchor) => void;
  onWordPress: (term: string, context: string, targetId?: string, anchor?: WordAnchor) => void;
}

/**
 * Render ordinary article prose as nested Text nodes.  Only English words
 * receive a press handler, so tapping a word never steals the ScrollView's
 * normal scrolling gesture.
 */
export function ClickableArticleParagraph({
  textStyle,
  isHeading = false,
  playbackRange,
  onTextLayout,
  text,
  segments,
  addedWords,
  addedWordColor,
  onWordPress,
  onSentenceLongPress,
  onSentenceAnchorChange,
}: ClickableArticleParagraphProps) {
  const paragraphRef = useRef<Text>(null);
  const linesRef = useRef<TextLayoutLine[]>([]);
  const selectionRef = useRef(0);
  const customTextStyle = StyleSheet.flatten(textStyle);
  const unaddedWordColor = customTextStyle?.color ?? '#000000';
  const savedWordHighlight = addedWordColor ?? '#f3bb31';
  let offset = 0;
  const tokens = segments?.flatMap<ArticleTextToken & { targetId?: string }>((segment) => {
    const start = offset;
    offset += segment.text.length;
    return segment.targetId
      ? [{ text: segment.text, isWord: true, key: `${start}:word`, targetId: segment.targetId }]
      : tokenizeArticleText(segment.text).map((token) => ({
          ...token, key: `${start + Number.parseInt(token.key, 10)}:${token.isWord ? 'word' : 'plain'}`,
          targetId: undefined,
        }));
  }) ?? tokenizeArticleText(text).map((token) => ({ ...token, targetId: undefined }));
  return (
    <Text
      ref={paragraphRef}
      onTextLayout={(event) => {
        linesRef.current = event.nativeEvent.lines;
        onTextLayout?.(event);
      }}
      selectable={!onSentenceLongPress}
      accessibilityRole={isHeading ? 'header' : undefined}
      style={[styles.paragraph, isHeading && styles.sectionHeading, { color: unaddedWordColor, fontWeight: isHeading ? '700' : '600' }, textStyle]}>
      {tokens.map((token) => token.isWord ? (
        <Text
          key={token.key}
          onLongPress={onSentenceLongPress ? (event) => {
            const selection = ++selectionRef.current;
            const offset = Number.parseInt(token.key, 10);
            const x = event?.nativeEvent?.pageX ?? 0;
            onSentenceLongPress(sentenceAtOffset(text, offset), {
              x, y: event?.nativeEvent?.pageY ?? 0,
            });
            const line = sentenceEndLine(text, offset, linesRef.current);
            if (line) paragraphRef.current?.measureInWindow((_x, y) => {
              if (selection === selectionRef.current) {
                onSentenceAnchorChange?.({ x, y: y + line.y + line.height });
              }
            });
          } : undefined}
          onPress={(event) => {
            selectionRef.current += 1;
            onWordPress(
              token.text,
              sentenceAtOffset(text, Number.parseInt(token.key, 10)),
              token.targetId,
              { x: event?.nativeEvent?.pageX ?? 0, y: event?.nativeEvent?.pageY ?? 0 },
            );
          }}
          style={{
            color: playbackRange && Number.parseInt(token.key, 10) >= playbackRange.start
              && Number.parseInt(token.key, 10) < playbackRange.end
              ? playbackRange.color : unaddedWordColor,
            // 目标词保持正文样式，避免收藏高亮提前透露自测内容。
            backgroundColor: !token.targetId && addedWords?.has(normalizeWord(token.text))
              ? savedWordHighlight
              : undefined,
            fontWeight: customTextStyle?.fontWeight ?? (isHeading ? '700' : '600'),
          }}>
          {token.text}
        </Text>
      ) : (
        token.text
      ))}
    </Text>
  );
}

export interface InteractiveWordParagraphProps {
  textStyle?: TextProps["style"];
  isHeading?: boolean;
  playbackRange?: { start: number; end: number; color: string };
  onTextLayout?: TextProps["onTextLayout"];
  text: string;
  segments?: ArticleSegment[];
  targetColor: string;
  textColor?: string;
  surfaceColor?: string;
  borderColor?: string;
  mutedColor?: string;
  dangerColor?: string;
  addedWords?: ReadonlySet<string>;
  addedWordColor?: string;
  lookupWord?: (
    term: string,
    context: string,
    targetId?: string,
  ) => Promise<string | WordLookup>;
  /** 辅助记录与本地释义独立；失败不阻塞查词，下次点击可重试。 */
  recordTargetLookup?: (targetId: string) => Promise<AssistanceResponse>;
  onWordAdded?: (term: string) => void;
  onAddToVocabulary?: (
    input: VocabularyInput,
    idempotencyKey: string,
  ) => Promise<void>;
}

type WordLookup = WordTranslationResult & { savedSourceSentence?: string | null };

interface VisibleWordHint {
  targetId?: string;
  term: string;
  context: string;
  partOfSpeech: string | null;
  meaningZh: string | null;
  loading: boolean;
  adding: boolean;
  added: boolean;
  error: string | null;
  phoneticUk?: string | null;
  phoneticUs?: string | null;
  savedSourceSentence?: string | null;
}

function safeWordHintError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '暂时无法显示这个词义';
}

function normalizeWord(term: string): string {
  return term.trim().toLocaleLowerCase('en-US');
}

function wordMeaningCacheKey(term: string, context: string): string {
  return `${normalizeWord(term)}\u0000${context.trim()}`;
}

function vocabularyItemKey(input: VocabularyInput): string {
  return JSON.stringify([
    normalizeWord(input.term),
    input.meaningZh.trim(),
    input.sourceSentence?.trim() ?? null,
  ]);
}

/** Return the complete sentence; word lookup's context limit must not truncate translation. */
export function sentenceAtOffset(text: string, offset: number): string {
  return text.slice(findSentenceStart(text, offset), findSentenceEnd(text, offset)).trim();
}

/** 按字符位置找到句末所在行，重复句子和跨行句子均使用实际排版。 */
export function sentenceEndLine(text: string, offset: number, lines: TextLayoutLine[]) {
  const end = findSentenceEnd(text, offset);
  let cursor = 0;
  for (const line of lines) {
    const start = text.indexOf(line.text, cursor);
    if (start < 0) return undefined;
    cursor = start + line.text.length;
    if (cursor >= end) return line;
  }
  return undefined;
}

const MAX_WORD_CONTEXT_LENGTH = 1_000;
const SENTENCE_BOUNDARY_PATTERN = /[.!?。！？]/u;

/** Keep lookup and vocabulary payloads within the shared context contract. */
export function contextForWord(text: string, term: string, offset?: number): string {
  const normalizedText = text;
  const normalizedTerm = normalizeWord(term);
  const token = offset === undefined ? tokenizeArticleText(text).find((item) =>
    item.isWord && normalizeWord(item.text) === normalizedTerm) : undefined;
  const termStart = offset ?? (token ? Number.parseInt(token.key, 10) : -1);
  if (termStart < 0) return normalizedText.slice(0, MAX_WORD_CONTEXT_LENGTH).trim();

  const sentenceStart = findSentenceStart(normalizedText, termStart);
  const sentenceEnd = findSentenceEnd(normalizedText, termStart + term.length);
  const sentence = normalizedText
    .slice(sentenceStart, sentenceEnd)
    .trim();
  if (sentence.length <= MAX_WORD_CONTEXT_LENGTH) return sentence;

  const relativeTermStart = Math.max(0, termStart - sentenceStart);
  const windowStart = Math.min(
    relativeTermStart,
    sentence.length - MAX_WORD_CONTEXT_LENGTH,
  );
  return sentence
    .slice(windowStart, windowStart + MAX_WORD_CONTEXT_LENGTH)
    .trim();
}

function findSentenceStart(text: string, from: number): number {
  for (let index = from - 1; index >= 0; index -= 1) {
    if (isSentenceBoundary(text, index)) return findSentenceEnd(text, index);
  }
  return 0;
}

function findSentenceEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (isSentenceBoundary(text, index)) {
      let end = index + 1;
      while (/[.!?。！？"”’')\]]/u.test(text[end] ?? '') && end < text.length) end += 1;
      return end;
    }
  }
  return text.length;
}

function isSentenceBoundary(text: string, index: number): boolean {
  const character = text[index] ?? '';
  if (!SENTENCE_BOUNDARY_PATTERN.test(character)) return false;
  if (character !== '.') return true;
  // Decimal points, initials, and common abbreviations are part of a sentence.
  if (/\d/u.test(text[index - 1] ?? '') && /\d/u.test(text[index + 1] ?? '')) return false;
  const prefix = text.slice(0, index + 1);
  if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e)\.$/iu.test(prefix)) return false;
  if (/\b[A-Z]\.$/u.test(prefix) || /\.[A-Za-z]$/u.test(text.slice(0, index + 2))) return false;
  return true;
}

/**
 * Article-reader variant that looks up any tapped word and can save the
 * resulting dictionary meaning through the existing vocabulary API.
 */
export function InteractiveWordParagraph({
  textStyle,
  isHeading = false,
  playbackRange,
  onTextLayout,
  text,
  segments,
  targetColor,
  textColor,
  surfaceColor = '#f5f5f5',
  borderColor = '#dedede',
  dangerColor = '#dc2626',
  addedWords,
  addedWordColor = '#f3bb31',
  mutedColor = '#666666',
  lookupWord = (term, context) => requestWordTranslation({ term, context })
    .then((result) => result),
  onWordAdded,
  onAddToVocabulary,
  recordTargetLookup,
}: InteractiveWordParagraphProps) {
  const [visibleHint, setVisibleHint] = useState<VisibleWordHint | null>(null);
  const owner = useId();
  const overlay = useReadingOverlay();
  const [anchor, setAnchor] = useState<WordAnchor>({ x: 0, y: 0 });
  const isActive = !overlay || overlay.activeId === owner;

  const [selectedSentence, setSelectedSentence] = useState<string | null>(null);
  const [sentenceCache] = useState(() => new Map<string, string>());
  const [sentenceRequests] = useState(() => new Map<string, Promise<string>>());

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const meaningsRef = useRef<Map<string, WordLookup>>(new Map());
  const [locallyAddedWords, setLocallyAddedWords] = useState<Set<string>>(
    () => new Set(),
  );
  const keyPromisesRef = useRef<Map<string, Promise<string>>>(new Map());

  const isWordAdded = (term: string): boolean => {
    const normalizedTerm = normalizeWord(term);
    return locallyAddedWords.has(normalizedTerm)
      || Boolean(addedWords?.has(normalizedTerm));
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const keyForItem = (input: VocabularyInput): Promise<string> => {
    const identity = vocabularyItemKey(input);
    const existing = keyPromisesRef.current.get(identity);
    if (existing) return existing;
    const created = createIdempotencyKey().catch((error) => {
      keyPromisesRef.current.delete(identity);
      throw error;
    });
    keyPromisesRef.current.set(identity, created);
    return created;
  };

  const showWord = async (term: string, context: string, targetId?: string, nextAnchor?: WordAnchor) => {
    overlay?.select(owner);
    if (nextAnchor) setAnchor(nextAnchor);
    const normalized = normalizeWord(term);
    if (!normalized) return;
    const wordContext = context.trim();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const cacheKey = wordMeaningCacheKey(term, wordContext);
    const syncAssistance = () => {
      if (!targetId || !recordTargetLookup) return;
      void recordTargetLookup(targetId).then((response) => {
        const source = response.sourceSentence;
        if (!source) return;
        const saved = meaningsRef.current.get(cacheKey);
        if (saved) meaningsRef.current.set(cacheKey, { ...saved, savedSourceSentence: source });
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        setVisibleHint((current) => current ? { ...current, savedSourceSentence: source } : current);
      }).catch(() => {
        // 释义来自离线词典；辅助记录失败时保留词卡，下次点击再次记录。
      });
    };
    const cached = meaningsRef.current.get(cacheKey);
    if (cached && (!isWordAdded(term) || cached.savedSourceSentence)) {
      setVisibleHint({
        ...cached,
        targetId,
        term,
        context: wordContext,
        partOfSpeech: cached.partOfSpeech,
        meaningZh: cached.meaningZh,
        loading: false,
        adding: false,
        added: isWordAdded(term),
        error: null,
      });
      syncAssistance();
      return;
    }

    setVisibleHint({
      targetId,
      term,
      context: wordContext,
      partOfSpeech: null,
      meaningZh: null,
      loading: true,
      adding: false,
      added: false,
      error: null,
    });
    try {
      const lookupContext = contextForWord(wordContext, term);
      const rawLookup = await (targetId ? lookupWord(term, lookupContext, targetId) : lookupWord(term, lookupContext));
      const lookup: WordLookup = typeof rawLookup === 'string'
        ? { partOfSpeech: '—', meaningZh: rawLookup.trim() }
        : {
            ...rawLookup,
            partOfSpeech: abbreviatePartOfSpeech(rawLookup.partOfSpeech),
            meaningZh: rawLookup.meaningZh.trim(),
          };
      const meaningZh = lookup.meaningZh;
      if (!meaningZh) throw new Error('empty word meaning');
      meaningsRef.current.set(cacheKey, lookup);
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setVisibleHint({
        ...lookup,
        targetId,
        term,
        context: wordContext,
        partOfSpeech: lookup.partOfSpeech,
        meaningZh,
        loading: false,
        adding: false,
        added: isWordAdded(term),
        error: null,
      });
      syncAssistance();
    } catch (error) {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setVisibleHint({
        targetId,
        term,
        context: wordContext,
        partOfSpeech: null,
        meaningZh: null,
        loading: false,
        adding: false,
        added: false,
        error: safeWordHintError(error),
      });
    }
  };

  const addVisibleWord = async () => {
    if (
      !onAddToVocabulary
      || !visibleHint?.meaningZh
      || visibleHint.adding
      || visibleHint.added
      || isWordAdded(visibleHint.term)
    ) {
      return;
    }
    const selected = visibleHint;
    const selectedRequestId = requestIdRef.current;
    const meaningZh = selected.meaningZh;
    if (!meaningZh) return;
    const item: VocabularyInput = {
      term: selected.term,
      meaningZh,
      sourceSentence: selected.context,
    };
    setVisibleHint({ ...selected, adding: true, error: null });
    try {
      const idempotencyKey = await keyForItem(item);
      await onAddToVocabulary(item, idempotencyKey);
      if (!mountedRef.current) return;
      setLocallyAddedWords((current) => {
        const next = new Set(current);
        next.add(normalizeWord(selected.term));
        return next;
      });
      onWordAdded?.(selected.term);
      const savedSourceSentence = selected.savedSourceSentence ?? item.sourceSentence;
      const wordPrefix = `${normalizeWord(selected.term)}\u0000`;
      for (const [cacheKey, lookup] of meaningsRef.current) {
        if (cacheKey.startsWith(wordPrefix)) {
          meaningsRef.current.set(cacheKey, { ...lookup, savedSourceSentence });
        }
      }
      if (requestIdRef.current !== selectedRequestId) return;
      setVisibleHint({
        ...selected,
        savedSourceSentence,
        adding: false,
        added: true,
        error: null,
      });
    } catch (error) {
      if (
        !mountedRef.current
        || requestIdRef.current !== selectedRequestId
      ) return;
      setVisibleHint({
        ...selected,
        adding: false,
        error: safeWordHintError(error),
      });
    }
  };

  const sentenceCard = (sentence: string, onClose: () => void) => (
    <SentenceTranslation
      key={`${owner}:${sentence}`}
      sentence={sentence}
      cache={sentenceCache}
      inFlight={sentenceRequests}
      color={textColor ?? '#000000'}
      surfaceColor={surfaceColor}
      borderColor={borderColor}
      dangerColor={dangerColor}
      onClose={onClose}
    />
  );

  return (
    <View>
      <ClickableArticleParagraph
        textStyle={textStyle}
        playbackRange={playbackRange}
        onTextLayout={onTextLayout}
        isHeading={isHeading}
        onSentenceAnchorChange={(nextAnchor) => {
          if (overlay) overlay.moveSentence(owner, nextAnchor);
          else setAnchor(nextAnchor);
        }}
        onSentenceLongPress={(sentence, nextAnchor) => {
          requestIdRef.current += 1;
          setVisibleHint(null);
          if (overlay) {
            overlay.showSentence({
              owner, anchor: nextAnchor,
              children: sentenceCard(sentence, overlay.closeSentence),
            });
          } else {
            setAnchor(nextAnchor);
            setSelectedSentence(sentence);
          }
        }}
        segments={segments}
        onWordPress={(term, context, targetId, nextAnchor) => void showWord(term, context, targetId, nextAnchor)}
        targetColor={targetColor}
        addedWordColor={addedWordColor}
        addedWords={new Set([
          ...(addedWords ?? []),
          ...locallyAddedWords,
        ])}
        text={text}
        textColor={textColor ?? '#000000'}
      />
      {selectedSentence && !overlay ? (
        <ReadingOverlay owner={owner} anchor={anchor} kind="sentence">
          {sentenceCard(selectedSentence, () => setSelectedSentence(null))}
        </ReadingOverlay>
      ) : null}
      {visibleHint && isActive ? (
        <ReadingOverlay owner={owner} anchor={anchor}>
          <View
            style={[
              styles.hint,
              { marginBottom: 0, marginTop: 0 },
              { backgroundColor: surfaceColor, borderColor },
            ]}>
            <View style={styles.hintHeader}>
              <Text style={styles.hintTerm}>
                {visibleHint.term}
              </Text>
              <TouchableOpacity
                accessibilityLabel="关闭词义提示"
                hitSlop={8}
                onPress={() => {
                  requestIdRef.current += 1;
                  setVisibleHint(null);
                }}>
                <Text style={styles.hintClose}>×</Text>
              </TouchableOpacity>
            </View>
            {visibleHint.loading ? (
              <ActivityIndicator color={targetColor} size="small" />
            ) : null}
            <WordPronunciation
              key={visibleHint.term}
              term={visibleHint.term}
              phoneticUk={visibleHint.phoneticUk}
              phoneticUs={visibleHint.phoneticUs}
            />
            {visibleHint.partOfSpeech ? (
              <Text style={styles.hintPartOfSpeech}>
                {visibleHint.partOfSpeech}
              </Text>
            ) : null}
            {visibleHint.meaningZh ? (
              <>
                <Text style={styles.hintMeaning}>
                  {visibleHint.meaningZh}
                </Text>
                <Text style={[styles.hintPartOfSpeech, { color: mutedColor }]}>剑桥本地词典 · 常用释义</Text>
              </>
            ) : null}
            <SavedWordContext sentence={visibleHint.savedSourceSentence} />
            {visibleHint.meaningZh && onAddToVocabulary ? (
              <TouchableOpacity
                accessibilityLabel={
                  isWordAdded(visibleHint.term) ? '已加入生词本' : '加入生词本'
                }
                disabled={visibleHint.adding || isWordAdded(visibleHint.term)}
                onPress={() => void addVisibleWord()}
                style={[
                  styles.addWordButton,
                  {
                    borderColor: isWordAdded(visibleHint.term)
                      ? addedWordColor
                      : borderColor,
                    opacity: visibleHint.adding ? 0.65 : 1,
                  },
                ]}>
                {visibleHint.adding ? (
                  <ActivityIndicator color={targetColor} size="small" />
                ) : (
                  <Text
                    style={[
                      styles.addWordIcon,
                      {
                        color: isWordAdded(visibleHint.term)
                          ? addedWordColor
                          : '#000000',
                      },
                    ]}>
                    {isWordAdded(visibleHint.term) ? '✓' : '+'}
                  </Text>
                )}
                <Text
                  style={[
                    styles.addWordText,
                    {
                      color: isWordAdded(visibleHint.term)
                        ? addedWordColor
                        : '#000000',
                    },
                  ]}>
                  {isWordAdded(visibleHint.term) ? '已加入生词本' : '加入生词本'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {visibleHint.error ? (
              <TouchableOpacity
                onPress={() => void showWord(visibleHint.term, visibleHint.context, visibleHint.targetId)}>
                <Text style={[styles.hintError, { color: dangerColor }]}>
                  {visibleHint.error} · 重试
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ReadingOverlay>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeading: { fontSize: 23, lineHeight: 32, marginTop: 16, marginBottom: 20 },
  paragraph: { fontSize: 17, lineHeight: 30, marginBottom: 18 },
  hint: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 18,
    marginTop: -10,
    padding: 12,
  },
  hintHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hintTerm: { color: '#000000', fontSize: 14, fontWeight: '600' },
  hintClose: { color: '#000000', fontSize: 22, lineHeight: 22 },
  hintPartOfSpeech: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
  hintMeaning: { color: '#000000', fontSize: 14, lineHeight: 21, marginTop: 6 },
  hintError: { fontSize: 13, marginTop: 6 },
  savedContext: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#dedede', marginTop: 12, paddingTop: 10 },
  contextLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  contextSentence: { fontSize: 14, lineHeight: 22 },
  addWordButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    marginTop: 10,
    minHeight: 34,
    paddingHorizontal: 9,
  },
  addWordIcon: { color: '#000000', fontSize: 17, fontWeight: '700', lineHeight: 17 },
  addWordText: { color: '#000000', fontSize: 12, fontWeight: '600' },
});
