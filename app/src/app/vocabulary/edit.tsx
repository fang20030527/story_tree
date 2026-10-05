import type { VocabularyContext } from '@context-reader/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import {
  deleteVocabularyContext,
  deleteVocabularyWord,
  getVocabularyWordContexts,
  renameVocabularyWord,
  updateVocabularyContext,
} from '@/api/practices';
import { confirmAction } from '@/components/confirm';
import { PrimaryAction, SectionHeading, SubpageHeader, TextAction } from '@/components/subpage';
import { radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

const message = (cause: unknown) => cause instanceof ApiError ? cause.message : '保存失败，请稍后重试';

function ContextEditor({ context, onSaved, onDelete, deletable }: {
  context: VocabularyContext; onSaved: (next: VocabularyContext) => void; onDelete: () => void; deletable: boolean;
}) {
  const { theme } = useAppTheme();
  const [meaning, setMeaning] = useState(context.meaningZh);
  const [sentence, setSentence] = useState(context.sourceSentence ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = meaning.trim() !== context.meaningZh || (sentence.trim() || null) !== context.sourceSentence;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateVocabularyContext(context.id, { meaningZh: meaning.trim(), sourceSentence: sentence.trim() || null }));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceAlt }]}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>中文释义</Text>
      <TextInput accessibilityLabel="中文释义" value={meaning} onChangeText={setMeaning} maxLength={200} editable={!saving}
        style={[styles.input, { color: theme.text, backgroundColor: theme.bg }]} />
      <Text style={[styles.label, { color: theme.textSecondary }]}>例句（可留空）</Text>
      <TextInput accessibilityLabel="例句" value={sentence} onChangeText={setSentence} multiline maxLength={10_000} editable={!saving}
        style={[styles.input, styles.multiline, { color: theme.text, backgroundColor: theme.bg }]} />
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
      <View style={styles.actions}>
        <TextAction label={saving ? '正在保存…' : '保存释义'} disabled={saving || !changed || !meaning.trim()} onPress={() => void save()} />
        {deletable ? <TextAction label="删除这个释义" tone="danger" disabled={saving} onPress={onDelete} /> : null}
      </View>
    </View>
  );
}

/** 修改生词的拼写、释义和例句，或删除单个释义。 */
export default function VocabularyEditScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ wordId: string; term: string }>();
  const [wordId, setWordId] = useState(params.wordId);
  const [savedTerm, setSavedTerm] = useState(params.term ?? '');
  const [term, setTerm] = useState(params.term ?? '');
  const [contexts, setContexts] = useState<VocabularyContext[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const renameKey = useRef<{ term: string; key: string } | null>(null);

  useEffect(() => {
    if (!wordId) return;
    let active = true;
    getVocabularyWordContexts(wordId)
      .then((result) => { if (active) { setContexts(result.contexts); setError(null); } })
      .catch((cause: unknown) => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [wordId]);

  const rename = async () => {
    const next = term.trim();
    setRenaming(true);
    setError(null);
    try {
      // A retry of the same spelling reuses its key, so a lost response cannot apply twice.
      if (renameKey.current?.term !== next) renameKey.current = { term: next, key: await createIdempotencyKey() };
      const renamed = await renameVocabularyWord(wordId, next, renameKey.current.key);
      renameKey.current = null;
      setSavedTerm(renamed.term);
      setWordId(renamed.wordId);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setRenaming(false);
    }
  };
  const deleteWord = () => confirmAction({
    title: `删除「${savedTerm}」？`,
    message: '这个单词和它的全部释义会从生词本删除，以前的练习文章和作答记录会保留。',
    confirmLabel: '删除', destructive: true,
  }, () => {
    void deleteVocabularyWord(wordId).then(() => router.back()).catch((cause: unknown) => setError(message(cause)));
  });
  const deleteContext = (context: VocabularyContext) => confirmAction({
    title: '删除这个释义？', message: context.meaningZh, confirmLabel: '删除', destructive: true,
  }, () => {
    void deleteVocabularyContext(context.id)
      .then(() => setContexts((current) => current?.filter((entry) => entry.id !== context.id) ?? null))
      .catch((cause: unknown) => setError(message(cause)));
  });

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SubpageHeader title="编辑生词" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <SectionHeading title="拼写" />
        <TextInput accessibilityLabel="单词拼写" value={term} onChangeText={setTerm} maxLength={80} editable={!renaming}
          autoCapitalize="none" autoCorrect={false} style={[styles.input, styles.term, { color: theme.text, backgroundColor: theme.surfaceAlt }]} />
        <Text style={[styles.hint, { color: theme.textMuted }]}>改成另一个单词时，全部释义会移到新单词，按新单词重新安排复习；只改大小写不影响复习记录。</Text>
        <PrimaryAction label={renaming ? '正在保存…' : '保存拼写'} busy={renaming}
          disabled={!term.trim() || term.trim() === savedTerm} onPress={() => void rename()} style={styles.primary} />

        <SectionHeading title="释义" />
        {contexts === null && !error ? <ActivityIndicator color={theme.accent} style={styles.loading} /> : null}
        {contexts?.map((context) => (
          <ContextEditor key={context.id} context={context} deletable={contexts.length > 1}
            onSaved={(next) => setContexts((current) => current?.map((entry) => entry.id === next.id ? next : entry) ?? null)}
            onDelete={() => deleteContext(context)} />
        ))}
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}

        <TextAction label="删除这个单词" tone="danger" onPress={deleteWord} style={styles.deleteWord} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 24 },
  card: { borderRadius: radius.content, padding: 14, marginTop: 12 },
  label: { fontSize: 12.5, marginTop: 6, marginBottom: 6 },
  input: { borderRadius: 12, minHeight: 44, paddingHorizontal: 12, fontSize: 15 },
  multiline: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
  term: { marginTop: 12, fontWeight: weight('semibold') },
  hint: { fontSize: 12, lineHeight: 19, marginTop: 8 },
  primary: { marginTop: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 10 },
  error: { fontSize: 13, lineHeight: 20, marginTop: 10 },
  loading: { marginVertical: 20 },
  deleteWord: { marginTop: 28, alignSelf: 'flex-start' },
});
