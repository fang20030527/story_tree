import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressFeedback } from '@/components/motion';
import { ListRow, SectionHeading, SubpageHeader } from '@/components/subpage';
import { fonts, radius, ThemeMode, themes, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { clearRecentViews } from '@/features/library/libraryStorage';

const APPEARANCE_OPTIONS: { key: ThemeMode; label: string; hint: string }[] = [
  { key: 'light', label: '浅色', hint: '纸色底，墨色字' },
  { key: 'dark', label: '深色', hint: '黑洞色底，适合夜读' },
];

export default function SettingsScreen() {
  const { theme, preference, setPreference } = useAppTheme();
  const insets = useSafeAreaInsets();

  const confirmClear = (
    title: string,
    message: string,
    action: () => Promise<void>,
  ) => {
    Alert.alert(title, message, [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          void action();
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SubpageHeader title="设置" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <SectionHeading title="外观" style={styles.firstSection} />
        <View style={styles.appearance}>
          {APPEARANCE_OPTIONS.map((option) => {
            const active = preference === option.key;
            const preview = themes[option.key];
            return (
              <PressFeedback key={option.key} accessibilityRole="button" accessibilityLabel={option.label}
                accessibilityState={{ selected: active }} onPress={() => setPreference(option.key)} containerStyle={styles.option} style={styles.optionInner}>
                <View style={[styles.preview, { backgroundColor: preview.bg, borderColor: active ? theme.text : theme.border, borderWidth: active ? 2 : StyleSheet.hairlineWidth }]}>
                  <Text style={[styles.previewText, { color: preview.text }]}>Aa</Text>
                  <View style={[styles.previewMark, { backgroundColor: preview.vermilion }]} />
                </View>
                <Text style={[styles.optionLabel, { color: theme.text, fontWeight: weight(active ? 'semibold' : 'regular') }]}>{option.label}</Text>
                <Text style={[styles.optionHint, { color: theme.textMuted }]}>{option.hint}</Text>
              </PressFeedback>
            );
          })}
        </View>

        <SectionHeading title="数据管理" />
        <ListRow label="清空最近观看" hint="只删除本机的阅读记录，不影响书架和词库"
          onPress={() => confirmClear('清空最近观看', '确定要清空全部最近观看记录吗？此操作不可恢复。', clearRecentViews)} />

        <SectionHeading title="关于" />
        <ListRow label="版本" value="0.1.0" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 24 },
  firstSection: { marginTop: 12 },
  appearance: { flexDirection: 'row', gap: 16, paddingTop: 16, paddingBottom: 4 },
  option: { flex: 1 },
  optionInner: { gap: 6 },
  preview: { height: 88, borderRadius: radius.content, padding: 12, justifyContent: 'space-between' },
  previewText: { fontFamily: fonts.display, fontSize: 26 },
  previewMark: { width: 16, height: 6, borderRadius: 3, transform: [{ rotate: '20deg' }] },
  optionLabel: { fontSize: 15 },
  optionHint: { fontSize: 12 },
});
