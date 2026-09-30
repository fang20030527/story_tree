import type { VocabularyWord } from '@context-reader/contracts';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getVocabularyWords } from '@/api/practices';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { saveVocabularyDraft } from '@/features/practice/practiceStorage';

export default function SelectWordsScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [words, setWords] = useState<VocabularyWord[]>([]);
  const [selected, setSelected] = useState<VocabularyWord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(true);
  const request = useCallback((next?: string) => getVocabularyWords({ limit: 100, ...(next ? { cursor: next } : {}) })
    .then(page => { if (mounted.current) { setWords(current => next ? [...current, ...page.items] : page.items); setCursor(page.nextCursor); } })
    .catch(error => { if (mounted.current) setMessage(error instanceof Error ? error.message : '词库暂时无法加载'); })
    .finally(() => { busy.current = false; if (mounted.current) setLoading(false); }), []);
  const load = (next?: string) => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setMessage(null); void request(next);
  };
  useEffect(() => { mounted.current = true; busy.current = true; void request(); return () => { mounted.current = false; }; }, [request]);
  const toggle = (word: VocabularyWord) => {
    if (selected.some(item => item.wordId === word.wordId)) setSelected(selected.filter(item => item.wordId !== word.wordId));
    else if (selected.length < 10) setSelected([...selected, word]);
    else setMessage('每次自定义练习最多选择 10 个词');
  };
  const confirm = async () => {
    if (busy.current || !selected.length) return;
    busy.current = true;
    setLoading(true);
    try { await saveVocabularyDraft(selected.map(word => ({ term: word.term, meaningZh: word.meaningZh, sourceSentence: word.sourceSentence ?? '' }))); if (mounted.current) router.push('/practice/new'); }
    catch { if (mounted.current) setMessage('暂时无法保存选词，请重试'); }
    finally { busy.current = false; if (mounted.current) setLoading(false); }
  };
  return <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
    <View style={styles.header}><TouchableOpacity accessibilityLabel="返回" onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={24} color={theme.text} /></TouchableOpacity><Text style={{ color: theme.text }}>自定义选词</Text><Text style={{ color: theme.accent }}>{selected.length}/10</Text></View>
    <ScrollView contentContainerStyle={styles.content}><Text style={[styles.title, { color: theme.text }]}>这一回，想练哪些词？</Text><Text style={{ color: theme.textMuted, lineHeight: 22 }}>从你的词库选择单词，确认后可编辑具体释义和语境。</Text><TextInput accessibilityLabel="搜索词库" value={query} onChangeText={setQuery} placeholder="搜索已加载的单词与释义" placeholderTextColor={theme.textMuted} style={[styles.search, { color: theme.text, borderColor: theme.border }]} />
      {words.filter(word => (word.term + word.meaningZh).toLowerCase().includes(query.trim().toLowerCase())).map(word => <TouchableOpacity key={word.wordId} accessibilityRole="checkbox" accessibilityState={{ checked: selected.some(item => item.wordId === word.wordId) }} accessibilityLabel={`选择 ${word.term}`} onPress={() => toggle(word)} style={[styles.word, { borderBottomColor: theme.border }]}><View style={{ flex: 1 }}><Text style={[styles.term, { color: theme.text }]}>{word.term}</Text><Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 5 }}>{word.meaningZh}</Text></View><Ionicons name={selected.some(item => item.wordId === word.wordId) ? 'checkbox' : 'square-outline'} color={theme.accent} size={24} /></TouchableOpacity>)}
      {loading ? <ActivityIndicator color={theme.accent} /> : cursor ? <TouchableOpacity style={styles.more} onPress={() => void load(cursor)}><Text style={{ color: theme.accent }}>加载更多单词</Text></TouchableOpacity> : !words.length ? <Text style={{ color: theme.textMuted, marginTop: 24 }}>词库暂无单词，可以先阅读文章或录入新词。</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, marginVertical: 14 }}>{message}</Text> : null}
      {message && !words.length ? <TouchableOpacity style={styles.more} onPress={() => void load()}><Text style={{ color: theme.accent }}>重试</Text></TouchableOpacity> : null}
      <TouchableOpacity onPress={() => router.push('/practice/new')} style={styles.more}><Text style={{ color: theme.accent }}>自己录入新单词 →</Text></TouchableOpacity>
    </ScrollView><View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom) }]}><TouchableOpacity accessibilityRole="button" disabled={!selected.length || loading} onPress={() => void confirm()} style={[styles.primary, { backgroundColor: selected.length ? theme.accent : theme.surfaceAlt }]}><Text style={{ color: selected.length ? theme.accentText : theme.textMuted }}>确认选词（{selected.length}）</Text></TouchableOpacity></View>
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 }, back: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  content: { padding: 24, width: '100%', maxWidth: 760, alignSelf: 'center' }, title: { fontSize: 28, lineHeight: 40, marginVertical: 18 },
  search: { borderBottomWidth: 1, minHeight: 50, marginVertical: 20, fontSize: 15 }, word: { flexDirection: 'row', gap: 20, alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth }, term: { fontFamily: fonts.display, fontSize: 29 },
  more: { minHeight: 48, justifyContent: 'center', alignItems: 'center' }, footer: { paddingHorizontal: 24, width: '100%', maxWidth: 760, alignSelf: 'center' }, primary: { minHeight: 52, justifyContent: 'center', alignItems: 'center', borderRadius: 3 },
});
