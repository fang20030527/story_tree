import React, { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import type { SpeakingMaterial } from './model';
import { transcriptFormatLabels, TranscriptExportError, type TranscriptExportFormat, type TranscriptNotes } from './transcriptDocument';
import { exportSpeakingTranscript } from './transcriptExport';

export function SpeakingTranscriptExport({ material, notes = {}, disabled = false }: {
  material: SpeakingMaterial; notes?: TranscriptNotes; disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  const [exporting, setExporting] = useState<TranscriptExportFormat | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const unavailable = disabled || material.summary || !material.cues.length;
  const run = async (format: TranscriptExportFormat) => {
    if (pending.current || unavailable) return;
    pending.current = true; setExporting(format); setError('');
    try { await exportSpeakingTranscript(material, notes, format); }
    catch (failure) {
      if (!(failure instanceof TranscriptExportError)) console.warn('[台词本导出] 未分类的导出失败', failure);
      setError(failure instanceof TranscriptExportError ? failure.message : `${transcriptFormatLabels[format]} 导出失败，请重试`);
    } finally { pending.current = false; setExporting(null); }
  };
  return <View style={styles.container}>
    <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 17, fontWeight: weight('bold') }}>导出台词本</Text>
    <Text style={[styles.hint, { color: theme.textMuted }]}>{material.summary ? '字幕加载完成后可以导出。' : !material.cues.length ? '先添加字幕，再导出台词本。' : '导出全部台词，包含时间戳、中英文和已保存笔记。'}</Text>
    <View style={styles.actions}>{(['pdf', 'word', 'markdown'] as const).map(format => {
      const label = `导出 ${transcriptFormatLabels[format]} 台词本`;
      const blocked = Boolean(unavailable || exporting);
      return <Pressable key={format} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: blocked, busy: exporting === format }}
        disabled={blocked} onPress={() => void run(format)} style={[styles.button, { backgroundColor: theme.accentSoft, opacity: blocked ? .5 : 1 }]}>
        {exporting === format ? <ActivityIndicator size="small" color={theme.accent} /> : null}
        <Text style={{ color: theme.accent, fontSize: 14, fontWeight: weight('semibold') }}>{exporting === format ? '正在导出…' : `${transcriptFormatLabels[format]} 台词本`}</Text>
      </Pressable>;
    })}</View>
    {!unavailable && Platform.OS === 'web' ? <Text style={[styles.hint, { color: theme.textMuted }]}>PDF 打开打印窗口，请选择「另存为 PDF」；Word 和 Markdown 直接下载。</Text> : null}
    {error ? <Text accessibilityRole="alert" style={[styles.hint, { color: theme.danger }]}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8, paddingVertical: 18 }, hint: { fontSize: 12, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { minHeight: 44, borderRadius: radius.pill, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
