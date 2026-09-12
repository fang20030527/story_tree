import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui';
import { ThemeMode, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  clearFavorites,
  clearRecentViews,
} from '@/features/library/libraryStorage';

const APPEARANCE_OPTIONS: {
  key: 'system' | ThemeMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
  { key: 'light', label: '浅色', icon: 'sunny-outline' },
  { key: 'dark', label: '深色', icon: 'moon-outline' },
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
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerSide}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>设置</Text>
        <View style={styles.headerSide} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionHeading, { color: theme.textSecondary }]}>外观</Text>
        <Card theme={theme} style={styles.card}>
          <View style={[styles.segment, { backgroundColor: theme.surfaceAlt }]}>
            {APPEARANCE_OPTIONS.map((o) => {
              const active = preference === o.key;
              return (
                <TouchableOpacity
                  key={o.key}
                  onPress={() => setPreference(o.key)}
                  style={[
                    styles.segmentItem,
                    active && {
                      backgroundColor: theme.surface,
                      borderColor: theme.accent,
                      borderWidth: 1,
                    },
                  ]}>
                  <Ionicons
                    name={o.icon}
                    size={16}
                    color={active ? theme.accent : theme.textMuted}
                  />
                  <Text
                    style={{
                      color: active ? theme.text : theme.textMuted,
                      fontSize: 12,
                      fontWeight: weight(active ? 'semibold' : 'regular'),
                    }}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        <Text style={[styles.sectionHeading, { color: theme.textSecondary }]}>数据管理</Text>
        <Card theme={theme} style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              confirmClear(
                '清空最近观看',
                '确定要清空全部最近观看记录吗？此操作不可恢复。',
                clearRecentViews,
              )
            }
            style={styles.dataRow}>
            <Ionicons name="time-outline" size={19} color={theme.textSecondary} />
            <Text style={[styles.dataLabel, { color: theme.text }]}>清空最近观看</Text>
            <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              confirmClear(
                '清空我的收藏',
                '确定要清空全部收藏吗？此操作不可恢复。',
                clearFavorites,
              )
            }
            style={[
              styles.dataRow,
              { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
            ]}>
            <Ionicons name="star-outline" size={19} color={theme.textSecondary} />
            <Text style={[styles.dataLabel, { color: theme.text }]}>清空我的收藏</Text>
            <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
          </TouchableOpacity>
        </Card>

        <Text style={[styles.sectionHeading, { color: theme.textSecondary }]}>关于</Text>
        <Card theme={theme} style={styles.card}>
          <View style={styles.dataRow}>
            <Ionicons name="information-circle-outline" size={19} color={theme.textSecondary} />
            <Text style={[styles.dataLabel, { color: theme.text }]}>版本</Text>
            <Text style={{ color: theme.textMuted, fontSize: 13 }}>0.1.0</Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  headerSide: { width: 32 },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  sectionHeading: {
    fontSize: 13,
    fontWeight: weight('semibold'),
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 8,
  },
  card: { padding: 14 },
  segment: { borderRadius: 10, flexDirection: 'row', gap: 4, padding: 4 },
  segmentItem: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  dataRow: { alignItems: 'center', flexDirection: 'row', paddingVertical: 12 },
  dataLabel: { flex: 1, fontSize: 15, marginLeft: 12 },
});
