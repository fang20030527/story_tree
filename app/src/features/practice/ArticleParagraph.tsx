import type {
  ArticleSegment,
  VocabularyInput,
  WordTranslationResult,
} from '@context-reader/contracts';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

interface ArticleParagraphProps {
  segments: ArticleSegment[];
  targetColor: string;
  textColor?: string;
  onTargetPress: (targetId: string) => void;
}

export function ArticleParagraph({
  segments,
  targetColor,
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
            onPress={targetId ? () => onTargetPress(targetId) : undefined}
            style={targetId
              ? { color: targetColor, fontWeight: '600' }
              : undefined}>
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
  const meaningsRef = useRef<Map<string, string>>(new Map());

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
    const cached = meaningsRef.current.get(targetId);
    if (cached) {
      setVisibleHint({ targetId, meaningZh: cached, loading: false, error: null });
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
      meaningsRef.current.set(targetId, response.hintMeaningZh);
      if (!mountedRef.current) return;
      setVisibleHint({
        targetId,
        meaningZh: response.hintMeaningZh,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        keyPromisesRef.current.delete(targetId);
      }
      if (!mountedRef.current) return;
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
              onPress={() => setVisibleHint(null)}>
              <Text style={[styles.hintClose, { color: mutedColor }]}>×</Text>
            </TouchableOpacity>
          </View>
          {visibleHint.loading ? (
            <ActivityIndicator color={targetColor} size="small" />
          ) : null}
          {visibleHint.meaningZh ? (
            <Text style={[styles.hintMeaning, { color: textColor }]}>
              {visibleHint.meaningZh}
            </Text>
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
  text: string;
  targetColor: string;
  textColor?: string;
  addedWords?: ReadonlySet<string>;
  addedWordColor?: string;
  onWordPress: (term: string, context: string) => void;
}

/**
 * Render ordinary article prose as nested Text nodes.  Only English words
 * receive a press handler, so tapping a word never steals the ScrollView's
 * normal scrolling gesture.
 */
export function ClickableArticleParagraph({
  text,
  targetColor,
  addedWords,
  addedWordColor,
  onWordPress,
}: ClickableArticleParagraphProps) {
  const unaddedWordColor = '#000000';
  const savedWordHighlight = addedWordColor ?? '#f3bb31';
  return (
    <Text
      selectable
      style={[styles.paragraph, { color: unaddedWordColor }]}>
      {tokenizeArticleText(text).map((token) => token.isWord ? (
        <Text
          key={token.key}
          onPress={() => onWordPress(token.text, text)}
          style={{
            color: unaddedWordColor,
            backgroundColor: addedWords?.has(normalizeWord(token.text))
              ? savedWordHighlight
              : undefined,
            fontWeight: '600',
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
  text: string;
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
  ) => Promise<string | WordTranslationResult>;
  onWordAdded?: (term: string) => void;
  onAddToVocabulary?: (
    input: VocabularyInput,
    idempotencyKey: string,
  ) => Promise<void>;
}

interface VisibleWordHint {
  term: string;
  context: string;
  partOfSpeech: string | null;
  meaningZh: string | null;
  loading: boolean;
  adding: boolean;
  added: boolean;
  error: string | null;
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

const MAX_WORD_CONTEXT_LENGTH = 1_000;
const SENTENCE_BOUNDARY_PATTERN = /[.!?。！？]/u;

/** Keep lookup and vocabulary payloads within the shared context contract. */
function contextForWord(text: string, term: string): string {
  const normalizedText = text.trim();
  if (normalizedText.length <= MAX_WORD_CONTEXT_LENGTH) return normalizedText;

  const normalizedTerm = normalizeWord(term);
  const termStart = normalizedText
    .toLocaleLowerCase('en-US')
    .indexOf(normalizedTerm);
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
    if (SENTENCE_BOUNDARY_PATTERN.test(text[index] ?? '')) return index + 1;
  }
  return 0;
}

function findSentenceEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (SENTENCE_BOUNDARY_PATTERN.test(text[index] ?? '')) return index + 1;
  }
  return text.length;
}

/**
 * Article-reader variant that looks up any tapped word and can save the
 * resulting contextual meaning through the existing vocabulary API.
 */
export function InteractiveWordParagraph({
  text,
  targetColor,
  textColor,
  surfaceColor = '#f5f5f5',
  borderColor = '#dedede',
  dangerColor = '#dc2626',
  addedWords,
  addedWordColor = '#f3bb31',
  lookupWord = (term, context) => requestWordTranslation({ term, context })
    .then((result) => result),
  onWordAdded,
  onAddToVocabulary,
}: InteractiveWordParagraphProps) {
  const [visibleHint, setVisibleHint] = useState<VisibleWordHint | null>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const meaningsRef = useRef<Map<string, WordTranslationResult>>(new Map());
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

  const showWord = async (term: string, context: string) => {
    const normalized = normalizeWord(term);
    if (!normalized) return;
    const wordContext = contextForWord(context, term);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const cacheKey = wordMeaningCacheKey(term, wordContext);
    const cached = meaningsRef.current.get(cacheKey);
    if (cached) {
      setVisibleHint({
        term,
        context: wordContext,
        partOfSpeech: cached.partOfSpeech,
        meaningZh: cached.meaningZh,
        loading: false,
        adding: false,
        added: isWordAdded(term),
        error: null,
      });
      return;
    }

    setVisibleHint({
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
      const rawLookup = await lookupWord(term, wordContext);
      const lookup: WordTranslationResult = typeof rawLookup === 'string'
        ? { partOfSpeech: '词性未知', meaningZh: rawLookup.trim() }
        : {
            partOfSpeech: rawLookup.partOfSpeech.trim(),
            meaningZh: rawLookup.meaningZh.trim(),
          };
      const meaningZh = lookup.meaningZh;
      if (!meaningZh) throw new Error('empty word meaning');
      meaningsRef.current.set(cacheKey, lookup);
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setVisibleHint({
        term,
        context: wordContext,
        partOfSpeech: lookup.partOfSpeech,
        meaningZh,
        loading: false,
        adding: false,
        added: isWordAdded(term),
        error: null,
      });
    } catch (error) {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setVisibleHint({
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
      if (
        !mountedRef.current
        || requestIdRef.current !== selectedRequestId
      ) return;
      setLocallyAddedWords((current) => {
        const next = new Set(current);
        next.add(normalizeWord(selected.term));
        return next;
      });
      onWordAdded?.(selected.term);
      setVisibleHint({ ...selected, adding: false, added: true, error: null });
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

  return (
    <View>
      <ClickableArticleParagraph
        onWordPress={(term, context) => void showWord(term, context)}
        targetColor={targetColor}
        addedWordColor={addedWordColor}
        addedWords={new Set([
          ...(addedWords ?? []),
          ...locallyAddedWords,
        ])}
        text={text}
        textColor={textColor ?? '#000000'}
      />
      {visibleHint ? (
        <View
          style={[
            styles.hint,
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
          {visibleHint.partOfSpeech ? (
            <Text style={styles.hintPartOfSpeech}>
              {visibleHint.partOfSpeech}
            </Text>
          ) : null}
          {visibleHint.meaningZh ? (
            <Text style={styles.hintMeaning}>
              {visibleHint.meaningZh}
            </Text>
          ) : null}
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
              onPress={() => void showWord(visibleHint.term, visibleHint.context)}>
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

const styles = StyleSheet.create({
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
