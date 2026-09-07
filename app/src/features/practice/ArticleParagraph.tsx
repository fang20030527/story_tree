import type { ArticleSegment } from '@context-reader/contracts';
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
import { recordAssistance } from '@/api/practices';

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
  hintTerm: { fontSize: 14, fontWeight: '600' },
  hintClose: { fontSize: 22, lineHeight: 22 },
  hintMeaning: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  hintError: { fontSize: 13, marginTop: 6 },
});
