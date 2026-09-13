import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Card } from '@/components/ui';
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
      <Card theme={theme} style={styles.card}>
        <View style={styles.row}>
          {importSources.map((source) => (
            <TouchableOpacity
              key={source.id}
              style={styles.item}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={source.label}
              onPress={() => openSource(source)}>
              <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
                <Ionicons
                  name={source.icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={theme.accent}
                />
              </View>
              <Text style={[styles.label, { color: theme.textSecondary }]}>
                {source.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 19, fontWeight: weight('bold'), marginBottom: 12 },
  card: { paddingVertical: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  item: { alignItems: 'center', width: 58 },
  icon: {
    alignItems: 'center', borderRadius: 14, height: 46,
    justifyContent: 'center', width: 46,
  },
  label: { fontSize: 12, fontWeight: weight('medium'), marginTop: 8 },
});
