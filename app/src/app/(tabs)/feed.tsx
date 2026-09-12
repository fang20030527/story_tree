import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, RemoteImage, SectionHeader } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { communityPosts, importSources, kidNewsItems, newsItems } from '@/data/mock';

export default function FeedScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  const handleImportPress = (source: (typeof importSources)[number]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (source.id === 'computer') {
      router.push('/import-computer');
      return;
    }
    router.push({ pathname: '/import', params: { source: source.id } });
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={[styles.headerButton, { borderColor: theme.border }]}
          hitSlop={8}>
          <Ionicons name="search" size={18} color={theme.textSecondary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>外刊</Text>
        <TouchableOpacity
          style={[styles.headerImport, { borderColor: theme.border }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="导入外部资源"
          onPress={() => router.push({ pathname: '/import', params: { source: 'select' } })}>
          <Text style={[styles.headerImportText, { color: theme.text }]}>导入</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}>
        {/* 公告条 */}
        <Card theme={theme} style={styles.notice}>
          <Ionicons name="notifications" size={16} color={theme.red} />
          <Text
            style={[styles.noticeText, { color: theme.text }]}
            numberOfLines={1}>
            AI 字幕与长文生成服务全面升级
          </Text>
          <Ionicons name="chevron-forward" size={14} color={theme.textMuted} />
        </Card>

        {/* 导入口子 */}
        <SectionHeader title="导入外部资源" theme={theme} />
        <Card theme={theme} style={styles.importCard}>
          <View style={styles.importRow}>
            {importSources.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.importItem}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={s.label}
                onPress={() => handleImportPress(s)}>
                <View style={[styles.importIconBox, { backgroundColor: theme.accentSoft }]}>
                  <Ionicons
                    name={s.icon as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color={theme.accent}
                  />
                </View>
                <Text style={[styles.importLabel, { color: theme.textSecondary }]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {/* 每日快讯 */}
        <View style={{ marginTop: 24 }}>
          <SectionHeader title="每日快讯" theme={theme} moreLabel="更多" />
          <View style={styles.newsGrid}>
            {newsItems.map((n) => (
              <TouchableOpacity key={n.id} style={styles.newsItem} activeOpacity={0.8}>
                <RemoteImage uri={n.image} style={styles.newsImage}>
                  <View style={[styles.tag, { backgroundColor: theme.green }]}>
                    <Text style={styles.tagText}>{n.tag}</Text>
                  </View>
                  <View style={styles.newsLogo}>
                    <Text style={styles.newsLogoText}>{n.logo}</Text>
                  </View>
                </RemoteImage>
                <Text
                  style={[styles.newsTitle, { color: theme.text }]}
                  numberOfLines={2}>
                  {n.title}
                </Text>
                <View style={styles.langRow}>
                  {n.langs.map((l) => (
                    <Text key={l} style={[styles.langText, { color: theme.accent }]}>
                      {l}
                    </Text>
                  ))}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Kid News */}
        <View style={{ marginTop: 24 }}>
          <SectionHeader title="Kid News" theme={theme} moreLabel="更多" />
          <View style={styles.newsGrid}>
            {kidNewsItems.map((n) => (
              <TouchableOpacity key={n.id} style={styles.newsItem} activeOpacity={0.8}>
                <RemoteImage uri={n.image} style={styles.newsImage}>
                  <View style={[styles.tag, { backgroundColor: theme.green }]}>
                    <Text style={styles.tagText}>{n.tag}</Text>
                  </View>
                </RemoteImage>
                <Text
                  style={[styles.newsTitle, { color: theme.text }]}
                  numberOfLines={2}>
                  {n.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 社区讨论（融合 App1 鹦语） */}
        <View style={{ marginTop: 24 }}>
          <SectionHeader title="学习讨论" theme={theme} moreLabel="更多" />
          {communityPosts.map((p) => (
            <Card key={p.id} theme={theme} style={styles.post}>
              <View style={styles.postHeader}>
                <View style={[styles.postAvatar, { backgroundColor: theme.accentSoft }]}>
                  <Ionicons name="person" size={16} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.postUser, { color: theme.text }]}>{p.user}</Text>
                  <Text style={[styles.postDate, { color: theme.textMuted }]}>
                    {p.date}
                  </Text>
                </View>
                <Ionicons name="flag-outline" size={14} color={theme.textMuted} />
              </View>
              <Text style={[styles.postText, { color: theme.text }]}>{p.text}</Text>
              <RemoteImage uri={p.image} style={styles.postImage} />
              <View style={styles.postFooter}>
                <View style={styles.postAction}>
                  <Ionicons name="chatbubble-outline" size={14} color={theme.blue} />
                  <Text style={[styles.postActionText, { color: theme.blue }]}>
                    {p.replies} 条回复
                  </Text>
                </View>
                <View style={styles.postAction}>
                  <Ionicons name="heart-outline" size={14} color={theme.textMuted} />
                  <Text style={[styles.postActionText, { color: theme.textMuted }]}>
                    {p.likes}
                  </Text>
                </View>
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: weight('semibold') },
  headerImport: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  headerImportText: { fontSize: 14, fontWeight: weight('medium') },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 20,
  },
  noticeText: { flex: 1, fontSize: 13 },
  importCard: { paddingVertical: 16 },
  importRow: { flexDirection: 'row', justifyContent: 'space-around' },
  importItem: { alignItems: 'center', width: 56 },
  importIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importLabel: { fontSize: 12, fontWeight: weight('medium'), marginTop: 8 },
  newsGrid: { flexDirection: 'row', gap: 12 },
  newsItem: { flex: 1 },
  newsImage: { height: 110, justifyContent: 'space-between', padding: 8 },
  tag: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: { color: '#fff', fontSize: 11, fontWeight: weight('semibold') },
  newsLogo: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  newsLogoText: { color: '#fff', fontSize: 10, fontWeight: weight('bold') },
  newsTitle: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  langRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  langText: { fontSize: 11, fontWeight: weight('medium') },
  post: { padding: 14, marginBottom: 12 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postUser: { fontSize: 14, fontWeight: weight('semibold') },
  postDate: { fontSize: 11, marginTop: 2 },
  postText: { fontSize: 14, lineHeight: 22, marginTop: 10 },
  postImage: { height: 140, marginTop: 10 },
  postFooter: { flexDirection: 'row', gap: 20, marginTop: 12 },
  postAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  postActionText: { fontSize: 12 },
});
