import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Card } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { loadPracticeTargetCount, MAX_TARGET_COUNT, parseTargetCount, savePracticeTargetCount } from './practicePreferences';

export function PracticePreferencesCard() {
  const { theme } = useAppTheme();
  const [value, setValue] = useState('');
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let current = true;
    void loadPracticeTargetCount().then((count) => {
      if (current) { setValue(String(count)); setSavedCount(count); setMessage(null); }
    }).catch(() => { if (current) setMessage('暂时无法读取设置，请重试保存'); });
    return () => { current = false; };
  }, []));
  const save = async () => {
    const count = parseTargetCount(value);
    if (count === null) { setMessage(`请输入 1–${MAX_TARGET_COUNT} 的整数`); return; }
    setSaving(true);
    try {
      await savePracticeTargetCount(count);
      setSavedCount(count);
      setValue(String(count));
      setMessage('已保存，下次生成练习时生效');
    } catch { setMessage('保存失败，请重试'); }
    finally { setSaving(false); }
  };
  return (
    <Card theme={theme} style={styles.card}>
      <Text style={[styles.title, { color: theme.text }]}>练习设置</Text>
      <Text style={[styles.label, { color: theme.textSecondary }]}>每次练习单词数量</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="每次练习单词数量"
          value={value}
          onChangeText={(text) => { setValue(text); setMessage(null); }}
          editable={!saving}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.bg }]}
        />
        <Text style={{ color: theme.textSecondary }}>个词</Text>
        <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => void save()}
          style={[styles.save, { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={{ color: theme.accentText }}>{saving ? '保存中…' : '保存'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.hint, { color: theme.textMuted }]}>
        {savedCount === null ? `每组最多选取 ${MAX_TARGET_COUNT} 个词，分配到四篇短文；不足时按实际数量练习。` : `每组最多选取 ${savedCount} 个待复习词，分配到四篇短文；不足时按实际数量练习。`}
      </Text>
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.textSecondary }]}>{message}</Text> : null}
    </Card>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, marginTop: 16 },
  title: { fontSize: 16, fontWeight: weight('bold') },
  label: { fontSize: 14, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 14, minHeight: 46, minWidth: 84, fontSize: 20, textAlign: 'center' },
  save: { marginLeft: 'auto', paddingHorizontal: 20, minHeight: 44, borderRadius: 10, justifyContent: 'center' },
  hint: { marginTop: 10, fontSize: 12, lineHeight: 19 },
});
