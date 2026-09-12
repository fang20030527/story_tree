import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ArticleImportDto } from '@context-reader/contracts';

import { ApiError } from '@/api/client';
import {
  confirmArticleImport,
  getArticleImport,
  updateImportPreview,
} from '@/api/imports';
import { createIdempotencyKey } from '@/api/installation';
import { useAppTheme } from '@/context/ThemeContext';
import type { Theme } from '@/constants/theme';
import {
  clearImportOperationKeys,
  clearActiveImportId,
  loadActiveImportId,
  loadOrCreateImportOperationKey,
  saveActiveImportId,
} from '@/features/imports/importStorage';
import { weight } from '@/constants/theme';

type DuplicateDecision = 'open_existing' | 'save_new_version';

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '预览暂时无法保存，请稍后重试';
}

function sourceLabel(sourceKind: ArticleImportDto['sourceKind']): string {
  switch (sourceKind) {
    case 'url': return '网页链接';
    case 'paste': return '粘贴正文';
    case 'album': return '相册';
    case 'local_file': return '本地文件';
    case 'computer': return '电脑上传';
  }
}

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).filter(Boolean).length : 0;
}

export default function ImportPreviewScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const paramId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [importId, setImportId] = useState<string | null>(paramId ?? null);
  const [articleImport, setArticleImport] = useState<ArticleImportDto | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [decision, setDecision] = useState<DuplicateDecision | undefined>();
  const editKeyRef = useRef<string | null>(null);
  const editPayloadRef = useRef<string | null>(null);
  const savedPayloadRef = useRef<string | null>(null);
  const confirmKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const id = paramId ?? await loadActiveImportId();
      if (!id) {
        if (mounted) {
          setLoading(false);
          setMessage('找不到待确认的导入任务');
        }
        return;
      }
      if (mounted) setImportId(id);
      try {
        const loaded = await getArticleImport(id);
        if (!mounted) return;
        if (loaded.status !== 'preview_ready' || !loaded.preview) {
          if (loaded.status === 'confirmed' && loaded.articleId) {
            router.replace({ pathname: '/article-read', params: { id: loaded.articleId } });
          } else {
            router.replace({ pathname: '/import-processing', params: { id } });
          }
          return;
        }
        setArticleImport(loaded);
        setTitle(loaded.preview.title);
        setText(loaded.preview.text);
        const savedPayload = JSON.stringify({ title: loaded.preview.title, text: loaded.preview.text });
        editPayloadRef.current = savedPayload;
        savedPayloadRef.current = savedPayload;
        await saveActiveImportId(loaded.id);
      } catch (error) {
        if (mounted) setMessage(messageFor(error));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [paramId]);

  const preview = articleImport?.preview;
  const wordCount = useMemo(() => countWords(text), [text]);
  const duplicate = preview?.duplicate;

  const saveEdit = async (): Promise<ArticleImportDto | null> => {
    if (!importId || saving || !title.trim() || !text.trim()) {
      if (!title.trim() || !text.trim()) setMessage('标题和正文不能为空');
      return null;
    }
    const payload = JSON.stringify({ title: title.trim(), text });
    if (editPayloadRef.current !== payload) {
      editPayloadRef.current = payload;
      editKeyRef.current = await createIdempotencyKey();
    }
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateImportPreview(
        importId,
        { title: title.trim(), text },
        editKeyRef.current!,
      );
      setArticleImport(updated);
      if (updated.preview) {
        setTitle(updated.preview.title);
        setText(updated.preview.text);
        const savedPayload = JSON.stringify({ title: updated.preview.title, text: updated.preview.text });
        editPayloadRef.current = savedPayload;
        savedPayloadRef.current = savedPayload;
      }
      setDecision(undefined);
      return updated;
    } catch (error) {
      setMessage(messageFor(error));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const confirm = async () => {
    if (!importId || confirming) return;
    if (!preview) {
      setMessage('预览内容还未准备好');
      return;
    }
    setConfirming(true);
    setMessage(null);
    try {
      let effectivePreview = preview;
      let effectiveDecision = decision;
      const currentPayload = JSON.stringify({ title: title.trim(), text });
      if (savedPayloadRef.current !== currentPayload) {
        const updated = await saveEdit();
        if (!updated?.preview) return;
        effectivePreview = updated.preview;
        // Editing changes the duplicate fingerprint, so an earlier choice is
        // no longer valid and must be made again for the saved preview.
        effectiveDecision = undefined;
      }
      if (!effectivePreview) {
        setMessage('预览内容还未准备好');
        return;
      }
      if (effectivePreview.duplicate.kind === 'similar' && !effectiveDecision) {
        setMessage('请先选择如何处理相似文章');
        return;
      }
      const key = confirmKeyRef.current ?? (confirmKeyRef.current = await loadOrCreateImportOperationKey(importId, 'confirm'));
      const confirmed = await confirmArticleImport(
        importId,
        effectivePreview.duplicate.kind === 'similar' && effectiveDecision
          ? { similarityDecision: effectiveDecision }
          : {},
        key,
      );
      if (confirmed.status !== 'confirmed' || !confirmed.articleId) {
        throw new ApiError('INVALID_SERVER_RESPONSE', '服务返回了无法识别的数据', true);
      }
      await clearImportOperationKeys(importId).catch(() => {});
      await clearActiveImportId().catch(() => {});
      router.replace({ pathname: '/article-read', params: { id: confirmed.articleId } });
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return <View style={[styles.centered, { backgroundColor: theme.bg }]}><ActivityIndicator color={theme.accent} /></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="返回"><Ionicons name="chevron-back" size={26} color={theme.text} /></TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>编辑导入预览</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {articleImport && preview ? (
          <>
            <View style={[styles.metaCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={[styles.metaIcon, { backgroundColor: theme.accentSoft }]}><Ionicons name="document-text-outline" size={23} color={theme.accent} /></View>
              <View style={styles.metaCopy}><Text style={[styles.metaTitle, { color: theme.text }]}>{sourceLabel(articleImport.sourceKind)}</Text><Text style={[styles.metaSubtitle, { color: theme.textMuted }]}>已解析 · 可在确认前修改</Text></View>
              <Text style={[styles.wordCount, { color: wordCount >= 20 && wordCount <= 5000 ? theme.green : theme.danger }]}>{wordCount} 词</Text>
            </View>
            <Text style={[styles.label, { color: theme.text }]}>标题</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="文章标题" placeholderTextColor={theme.textMuted} style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]} />
            <Text style={[styles.label, { color: theme.text }]}>正文</Text>
            <TextInput value={text} onChangeText={setText} multiline scrollEnabled={false} textAlignVertical="top" placeholder="文章正文" placeholderTextColor={theme.textMuted} style={[styles.textArea, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]} />

            {duplicate?.kind === 'exact' ? (
              <DuplicateCard theme={theme} title="发现完全相同的文章" body={`已有文章「${duplicate.article.title}」· ${duplicate.article.wordCount} 词`} icon="checkmark-circle-outline" />
            ) : null}
            {duplicate?.kind === 'similar' ? (
              <View style={[styles.duplicateBox, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
                <View style={styles.duplicateHeading}><Ionicons name="copy-outline" size={19} color={theme.accent} /><Text style={[styles.duplicateTitle, { color: theme.text }]}>发现相似文章</Text></View>
                <Text style={[styles.duplicateBody, { color: theme.textSecondary }]}>「{duplicate.article.title}」· {duplicate.article.wordCount} 词</Text>
                <View style={styles.decisionRow}>
                  <DecisionButton theme={theme} selected={decision === 'open_existing'} label="打开已有文章" onPress={() => setDecision('open_existing')} />
                  <DecisionButton theme={theme} selected={decision === 'save_new_version'} label="保存为新版本" onPress={() => setDecision('save_new_version')} />
                </View>
              </View>
            ) : null}

            {message ? <Text style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}
            <TouchableOpacity disabled={saving} onPress={() => void saveEdit()} style={[styles.secondaryButton, { borderColor: theme.border, opacity: saving ? 0.65 : 1 }]} activeOpacity={0.8}>
              {saving ? <ActivityIndicator color={theme.blue} /> : <><Ionicons name="save-outline" size={17} color={theme.blue} /><Text style={[styles.secondaryButtonText, { color: theme.blue }]}>保存修改并重新校验</Text></>}
            </TouchableOpacity>
            <TouchableOpacity disabled={confirming || saving} onPress={() => void confirm()} style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: confirming || saving ? 0.65 : 1 }]} activeOpacity={0.85}>
              {confirming ? <ActivityIndicator color={theme.accentText} /> : <><Text style={[styles.primaryButtonText, { color: theme.accentText }]}>{duplicate?.kind === 'exact' ? '打开已有文章' : '确认并保存文章'}</Text><Ionicons name="arrow-forward" size={18} color={theme.accentText} /></>}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.empty}><Ionicons name="alert-circle-outline" size={34} color={theme.danger} /><Text style={[styles.emptyTitle, { color: theme.text }]}>预览暂不可用</Text>{message ? <Text style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}</View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DuplicateCard({ theme, title, body, icon }: { theme: Theme; title: string; body: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={[styles.duplicateBox, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}><View style={styles.duplicateHeading}><Ionicons name={icon} size={19} color={theme.green} /><Text style={[styles.duplicateTitle, { color: theme.text }]}>{title}</Text></View><Text style={[styles.duplicateBody, { color: theme.textSecondary }]}>{body}</Text></View>;
}

function DecisionButton({ theme, selected, label, onPress }: { theme: Theme; selected: boolean; label: string; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} style={[styles.decisionButton, { backgroundColor: selected ? theme.accent : theme.surface, borderColor: selected ? theme.accent : theme.border }]} activeOpacity={0.8}><Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={16} color={selected ? theme.accentText : theme.textMuted} /><Text style={[styles.decisionText, { color: selected ? theme.accentText : theme.text }]}>{label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 16 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  headerSpacer: { width: 26 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  metaCard: { alignItems: 'center', borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginBottom: 22, padding: 12 },
  metaIcon: { alignItems: 'center', borderRadius: 10, height: 42, justifyContent: 'center', width: 42 },
  metaCopy: { flex: 1, marginLeft: 10 },
  metaTitle: { fontSize: 14, fontWeight: weight('semibold') },
  metaSubtitle: { fontSize: 11, marginTop: 4 },
  wordCount: { fontSize: 12, fontWeight: weight('semibold') },
  label: { fontSize: 15, fontWeight: weight('semibold'), marginBottom: 9, marginTop: 5 },
  input: { borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, fontSize: 15, marginBottom: 18, minHeight: 48, paddingHorizontal: 13 },
  textArea: { borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, fontSize: 15, lineHeight: 22, marginBottom: 18, minHeight: 280, padding: 13 },
  duplicateBox: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8, padding: 13 },
  duplicateHeading: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  duplicateTitle: { fontSize: 14, fontWeight: weight('semibold') },
  duplicateBody: { fontSize: 12, lineHeight: 19, marginTop: 7 },
  decisionRow: { gap: 8, marginTop: 12 },
  decisionButton: { alignItems: 'center', borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, minHeight: 42, paddingHorizontal: 11 },
  decisionText: { flex: 1, fontSize: 13, fontWeight: weight('medium') },
  message: { fontSize: 13, lineHeight: 20, marginBottom: 4, marginTop: 10, textAlign: 'center' },
  primaryButton: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 12, minHeight: 52, paddingHorizontal: 18 },
  primaryButtonText: { fontSize: 16, fontWeight: weight('bold') },
  secondaryButton: { alignItems: 'center', borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 12, minHeight: 46 },
  secondaryButtonText: { fontSize: 14, fontWeight: weight('semibold') },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 180 },
  emptyTitle: { fontSize: 18, fontWeight: weight('semibold'), marginTop: 12 },
});
