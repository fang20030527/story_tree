import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  getEditorialArticle,
  type EditorialArticle,
} from '@/features/editorial/catalog';
import { recordEditorialRecentView } from '@/features/library/libraryStorage';

type Props = { articleId: string };

export function EditorialReadScreen({ articleId }: Props) {
  const article = getEditorialArticle(articleId);
  return article ? (
    <EditorialReadContent article={article} />
  ) : (
    <MissingEditorialArticleState />
  );
}

function EditorialReadContent({ article }: { article: EditorialArticle }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void recordEditorialRecentView(article.id).catch(() => undefined);
  }, [article.id]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>平台外刊</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}>
        <Text style={[styles.kicker, { color: theme.accent }]}>
          {article.source} · {article.category}
        </Text>
        <Text selectable style={[styles.titleEn, { color: theme.text }]}>
          {article.titleEn}
        </Text>
        <Text style={[styles.titleZh, { color: theme.textSecondary }]}>
          {article.titleZh}
        </Text>
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {article.wordCount} 词 · {article.minutes} 分钟 · {article.level}
        </Text>
        <View style={styles.body}>
          {article.paragraphs.map((paragraph, index) => (
            <Text
              key={`${article.id}:${index}`}
              selectable
              style={[styles.paragraph, { color: theme.text }]}>
              {paragraph}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function MissingEditorialArticleState() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>平台外刊</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.missing}>
        <Text style={[styles.missingTitle, { color: theme.text }]}>文章不存在</Text>
        <TouchableOpacity
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          accessibilityLabel="返回外刊">
          <Text style={{ color: theme.blue }}>返回外刊</Text>
        </TouchableOpacity>
      </View>
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
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  headerSpacer: { width: 26 },
  content: { paddingHorizontal: 18, paddingTop: 16 },
  kicker: { fontSize: 12, fontWeight: weight('semibold') },
  titleEn: { fontSize: 28, fontWeight: weight('bold'), lineHeight: 36, marginTop: 12 },
  titleZh: { fontSize: 16, lineHeight: 24, marginTop: 10 },
  meta: { fontSize: 12, marginTop: 10 },
  body: { gap: 22, marginTop: 28 },
  paragraph: { fontSize: 17, lineHeight: 30 },
  missing: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center' },
  missingTitle: { fontSize: 18, fontWeight: weight('semibold') },
});
