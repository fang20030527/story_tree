import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { importSources } from '@/data/mock';

export function ImportSourceGrid() {
  const { theme } = useAppTheme();
  const openSource = (source: (typeof importSources)[number]) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      .catch(() => undefined);
    if (source.id === 'computer') {
      router.push('/import-computer');
    } else {
      router.push({ pathname: '/import', params: { source: source.id } });
    }
  };

  return (
    <View>
      <Text style={[styles.heading, { color: theme.text }]}>导入文章</Text>
      <View style={styles.row}>
        {importSources.map((source) => (
          <TouchableOpacity
            key={source.id}
            style={[styles.item, { backgroundColor: theme.surfaceAlt }]}
            activeOpacity={0.86}
            accessibilityRole="button"
            accessibilityLabel={source.label}
            onPress={() => openSource(source)}>
            <Ionicons
              name={source.icon as keyof typeof Ionicons.glyphMap}
              size={22}
              color={theme.textSecondary}
            />
            <Text style={[styles.label, { color: theme.textSecondary }]}>
              {source.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 19, lineHeight: 26, fontWeight: weight('semibold'), marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8 },
  item: { alignItems: 'center', flex: 1, borderRadius: 16, paddingTop: 14, paddingBottom: 10 },
  label: { fontSize: 12, fontWeight: weight('medium'), marginTop: 6 },
});
