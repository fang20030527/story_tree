import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { FadeIn, PressFeedback, animateNextLayout, useReducedMotion } from '@/components/motion';
import { fonts, orbitTilt, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

import {
  MAX_DRAFT_WORDS,
  type VocabularyDraftRow,
  emptyDraftRow,
  isUnlistedMeaning,
  validateVocabularyDraft,
  withTerm,
} from './practiceDraft';

const SETTLE_DELAY_MS = 250;

interface VocabularyInputListProps {
  value: VocabularyDraftRow[];
  onChange: (rows: VocabularyDraftRow[]) => void;
  /** 某一行输入结束（失焦或按回车）时调用，用来把查不到的词标成未收录。 */
  onSettle: () => void;
  validationAttempted: boolean;
  disabled?: boolean;
}

/** 只录入单词：每行一个词，下方显示本地词典释义；没有卡片和输入框边框，靠细线分行。 */
export function VocabularyInputList({
  value,
  onChange,
  onSettle,
  validationAttempted,
  disabled = false,
}: VocabularyInputListProps) {
  const { theme } = useAppTheme();
  const reduced = useReducedMotion();
  const inputs = useRef<(TextInput | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const settleTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const validation = useMemo(() => validateVocabularyDraft(value), [value]);
  const lastIsBlank = !value[value.length - 1]?.term.trim();
  const canAdd = !disabled && (lastIsBlank || value.length < MAX_DRAFT_WORDS);

  useEffect(() => {
    const timers = settleTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // 新加的行渲染出来后再聚焦。
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null || index >= value.length) return;
    pendingFocus.current = null;
    inputs.current[index]?.focus();
  }, [value.length]);

  const focusRow = (index: number) => {
    if (index < value.length) inputs.current[index]?.focus();
    else pendingFocus.current = index;
  };

  const addRow = () => {
    if (lastIsBlank) {
      focusRow(value.length - 1);
      return;
    }
    if (value.length >= MAX_DRAFT_WORDS) return;
    animateNextLayout(reduced);
    onChange([...value, emptyDraftRow()]);
    focusRow(value.length);
  };

  const removeRow = (index: number) => {
    animateNextLayout(reduced);
    onChange(value.length > 1 ? value.filter((_, i) => i !== index) : [emptyDraftRow()]);
    setTouched(new Set());
  };

  // Web 上按下按钮会先让输入框失焦；稍后再显示释义和提示，免得按钮在松手前被挤走。
  const settle = (index: number) => {
    setFocused((current) => (current === index ? null : current));
    const timer = setTimeout(() => {
      settleTimers.current.delete(timer);
      setTouched((current) => new Set(current).add(index));
      onSettle();
    }, SETTLE_DELAY_MS);
    settleTimers.current.add(timer);
  };

  // 焦点移到下一行时失焦会触发查词；焦点不动时才直接补释义。
  const submitRow = (index: number) => {
    if (index < value.length - 1) focusRow(index + 1);
    else if (value[index]?.term.trim() && value.length < MAX_DRAFT_WORDS) addRow();
    else onSettle();
  };

  return (
    <View>
      {value.map((row, index) => {
        const meaning = row.meaningZh.trim();
        const unlisted = meaning && isUnlistedMeaning(meaning);
        const error = validationAttempted || touched.has(index) ? validation.rowErrors[index]?.term : undefined;
        const removable = value.length > 1 || Boolean(row.term);
        return (
          <View key={index} style={styles.row}>
            <Text style={[styles.index, { color: focused === index ? theme.text : theme.textMuted }]}>
              {String(index + 1).padStart(2, '0')}
            </Text>
            <View style={styles.body}>
              <TextInput
                ref={(input) => { inputs.current[index] = input; }}
                accessibilityLabel={`第 ${index + 1} 个单词或短语`}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!disabled}
                maxLength={80}
                onBlur={() => settle(index)}
                onChangeText={(text) => onChange(value.map((current, i) => (i === index ? withTerm(current, text) : current)))}
                onFocus={() => setFocused(index)}
                onSubmitEditing={() => submitRow(index)}
                placeholder={index === 0 ? '例如 resilient' : '下一个单词'}
                placeholderTextColor={theme.textMuted}
                returnKeyType="next"
                selectionColor={theme.accent}
                submitBehavior="submit"
                style={[styles.term, { color: theme.text }, Platform.OS === 'web' ? styles.webInput : null]}
                value={row.term}
              />
              {meaning && !unlisted ? (
                <FadeIn key={meaning}>
                  <Text numberOfLines={2} style={[styles.meaning, { color: theme.textSecondary }]}>
                    {meaning.replace(/\s*\n\s*/gu, '  ')}
                  </Text>
                </FadeIn>
              ) : null}
              {unlisted ? (
                <FadeIn key="unlisted" style={styles.notice}>
                  <View style={[styles.noticeMark, { backgroundColor: theme.vermilion }]} />
                  <View style={styles.noticeCopy}>
                    <Text style={[styles.noticeTitle, { color: theme.text }]}>词典未收录</Text>
                    <Text style={[styles.noticeText, { color: theme.textMuted }]}>检查一下拼写；保留的话按常见含义生成</Text>
                  </View>
                </FadeIn>
              ) : null}
              {error ? (
                <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.danger }]}>{error}</Text>
              ) : null}
            </View>
            {removable ? (
              <PressFeedback
                accessibilityRole="button"
                accessibilityLabel={`删除第 ${index + 1} 个单词`}
                disabled={disabled}
                hitSlop={4}
                onPress={() => removeRow(index)}
                style={styles.remove}>
                <Ionicons name="close" size={18} color={theme.textMuted} />
              </PressFeedback>
            ) : <View style={styles.remove} />}
            <View style={[styles.rule, focused === index
              ? { backgroundColor: theme.text, height: 1.5 }
              : { backgroundColor: theme.border }]} />
          </View>
        );
      })}

      <PressFeedback
        accessibilityRole="button"
        accessibilityLabel="添加一个单词"
        accessibilityState={{ disabled: !canAdd }}
        disabled={!canAdd}
        onPress={addRow}
        style={[styles.add, { opacity: canAdd ? 1 : 0.45 }]}>
        <Ionicons name="add" size={18} color={theme.accent} />
        <Text style={[styles.addText, { color: theme.accent }]}>
          {value.length >= MAX_DRAFT_WORDS && !lastIsBlank ? `最多 ${MAX_DRAFT_WORDS} 个单词` : '添加单词'}
        </Text>
      </PressFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 12, paddingBottom: 14 },
  index: { fontFamily: fonts.display, fontSize: 13, lineHeight: 34, width: 22 },
  body: { flex: 1, minWidth: 0 },
  term: { fontFamily: fonts.readingSemibold, fontSize: 21, lineHeight: 28, minHeight: 34, paddingVertical: 3, paddingHorizontal: 0 },
  webInput: { outlineWidth: 0 },
  meaning: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 5 },
  noticeMark: { width: 10, height: 4, borderRadius: 5, marginTop: 8, transform: [{ rotate: orbitTilt }] },
  noticeCopy: { flex: 1, minWidth: 0 },
  noticeTitle: { fontSize: 13, lineHeight: 20, fontWeight: weight('semibold') },
  noticeText: { fontSize: 12, lineHeight: 18 },
  error: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  remove: { width: 34, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  rule: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, pointerEvents: 'none' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 52, alignSelf: 'flex-start', paddingRight: 12 },
  addText: { fontSize: 15, fontWeight: weight('semibold') },
});
