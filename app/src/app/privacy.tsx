import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubpageHeader } from '@/components/subpage';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { PRIVACY_POLICY } from '@/features/legal/privacyPolicy';

/** 隐私政策。网页版的同一路径 /privacy 也是 App Store Connect 填写的隐私政策网址。 */
export default function PrivacyPolicyScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SubpageHeader title="隐私政策" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {PRIVACY_POLICY.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{section.title}</Text>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} selectable style={[styles.paragraph, { color: theme.textSecondary }]}>{paragraph}</Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 8 },
  section: { marginBottom: 22 },
  title: { fontSize: 17, fontWeight: weight('semibold'), marginBottom: 8 },
  paragraph: { fontSize: 14, lineHeight: 23, marginBottom: 8 },
});
