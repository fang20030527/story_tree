import type { ArticleParagraph } from '@context-reader/contracts';
import { useCallback, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

interface QuizArticleReferenceProps {
  activeTargetId: string;
  paragraphs: ArticleParagraph[];
  title: string;
}

interface ReferenceParagraphProps {
  activeTargetId: string;
  isActive: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  paragraph: ArticleParagraph;
}

function ReferenceParagraph({
  activeTargetId,
  isActive,
  onLayout,
  paragraph,
}: ReferenceParagraphProps) {
  const { theme } = useAppTheme();

  return (
    <View
      onLayout={onLayout}
      style={styles.paragraphBlock}
      testID={`quiz-reference-paragraph-${paragraph.position}`}>
      <Text
        style={[
          styles.paragraphIndex,
          { color: isActive ? theme.accent : theme.textMuted },
        ]}>
        {String(paragraph.position + 1).padStart(2, '0')}
      </Text>
      <Text style={[styles.paragraph, { color: theme.text }]}>
        {paragraph.segments.map((segment, index) => {
          const isCurrentTerm = segment.targetId === activeTargetId;
          return (
            <Text
              accessibilityLabel={isCurrentTerm
                ? `当前题目原文词汇：${segment.text}`
                : undefined}
              key={`${index}-${segment.targetId ?? 'plain'}`}
              style={isCurrentTerm
                ? {
                    backgroundColor: theme.accentSoft,
                    color: theme.accent,
                    fontWeight: weight('semibold'),
                  }
                : undefined}>
              {segment.text}
            </Text>
          );
        })}
      </Text>
    </View>
  );
}

export function QuizArticleReference({
  activeTargetId,
  paragraphs,
  title,
}: QuizArticleReferenceProps) {
  const { theme } = useAppTheme();
  const scrollViewRef = useRef<ScrollView>(null);
  const activeParagraph = paragraphs.find((paragraph) => (
    paragraph.segments.some((segment) => segment.targetId === activeTargetId)
  ));

  const focusActiveParagraph = useCallback((event: LayoutChangeEvent) => {
    scrollViewRef.current?.scrollTo({
      animated: false,
      y: Math.max(0, event.nativeEvent.layout.y - 12),
    });
  }, []);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.surface }]}
      testID="quiz-reference-pane">
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerCopy}>
          <Text
            accessibilityRole="header"
            style={[styles.eyebrow, { color: theme.accent }]}>
            原文
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: theme.text }]}>
            {title}
          </Text>
        </View>
        {activeParagraph ? (
          <Text style={[styles.location, { color: theme.textMuted }]}>
            第 {activeParagraph.position + 1} 段
          </Text>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        testID="quiz-reference-scroll">
        {paragraphs.map((paragraph) => {
          const isActive = paragraph.id === activeParagraph?.id;
          return (
            <ReferenceParagraph
              activeTargetId={activeTargetId}
              isActive={isActive}
              key={paragraph.id}
              onLayout={isActive ? focusActiveParagraph : undefined}
              paragraph={paragraph}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    fontSize: 11,
    fontWeight: weight('bold'),
    letterSpacing: 1.2,
  },
  title: { fontSize: 14, fontWeight: weight('semibold'), marginTop: 2 },
  location: { fontSize: 12, fontWeight: weight('medium') },
  scroll: { flex: 1 },
  content: { paddingBottom: 18, paddingHorizontal: 18, paddingTop: 16 },
  paragraphBlock: { marginBottom: 18 },
  paragraphIndex: {
    fontSize: 10,
    fontWeight: weight('bold'),
    letterSpacing: 1,
    marginBottom: 5,
  },
  paragraph: { fontSize: 16, lineHeight: 27 },
});
