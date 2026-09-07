import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Chip, RemoteImage, SectionHeader } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { heroArticle, pastArticles } from '@/data/mock';

const TOP_TABS = ['文章', '书籍', '活动'];

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [topTab, setTopTab] = useState('文章');

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topTabs}>
          {TOP_TABS.map((t) => (
            <TouchableOpacity key={t} onPress={() => setTopTab(t)} hitSlop={8}>
              <View style={styles.topTabItem}>
                <Text
                  style={[
                    styles.topTabText,
                    { color: topTab === t ? theme.text : theme.textMuted },
                  ]}>
                  {t}
                </Text>
                {t === '活动' ? (
                  <View style={[styles.hotBadge, { backgroundColor: theme.danger }]}>
                    <Text style={styles.hotText}>HOT</Text>
                  </View>
                ) : null}
                {topTab === t ? (
                  <View style={[styles.topTabUnderline, { backgroundColor: theme.accent }]} />
                ) : (
                  <View style={styles.topTabUnderline} />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}>
        {/* 生词长文练习 banner */}
        <Card theme={theme} style={styles.banner}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: theme.text }]}>
              用你的生词生成长文练习
            </Text>
            <Text style={[styles.bannerSub, { color: theme.textMuted }]}>
              1–10 个具体义项
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/practice/new')}
              style={[styles.bannerButton, { backgroundColor: theme.accent }]}
              activeOpacity={0.85}>
              <Text style={[styles.bannerButtonText, { color: theme.accentText }]}>
                录入词义
              </Text>
              <Ionicons name="chevron-forward" size={14} color={theme.accentText} />
            </TouchableOpacity>
          </View>
          <Ionicons
            name="book-outline"
            size={64}
            color={theme.accent}
            style={{ opacity: 0.35 }}
          />
        </Card>

        {/* TODAY */}
        <Text style={[styles.todayTitle, { color: theme.text }]}>TODAY</Text>
        <Text style={[styles.todayDate, { color: theme.textMuted }]}>Sep.05 · 2026</Text>

        {/* 今日主文章大卡片 */}
        <Card theme={theme} style={styles.heroCard}>
          <RemoteImage uri={heroArticle.image} style={styles.heroImage}>
            <View style={styles.heroOverlay}>
              <View style={styles.heroMetaRow}>
                <Ionicons name="videocam-outline" size={13} color="#fff" />
                <Text style={styles.heroMetaText}>
                  {heroArticle.narrator} ｜ {heroArticle.category}
                </Text>
              </View>
              <Text style={styles.heroTitle}>{heroArticle.title}</Text>
              <View style={styles.heroBottom}>
                <View style={styles.readersRow}>
                  <View style={styles.avatarStack}>
                    {[0, 1, 2].map((i) => (
                      <View
                        key={i}
                        style={[styles.miniAvatar, { marginLeft: i === 0 ? 0 : -8 }]}>
                        <Ionicons name="person" size={10} color="#fff" />
                      </View>
                    ))}
                  </View>
                  <Text style={styles.readersText}>{heroArticle.readers}人在读</Text>
                </View>
                <TouchableOpacity
                  style={[styles.startButton, { backgroundColor: theme.accent }]}
                  activeOpacity={0.85}>
                  <Text style={[styles.startButtonText, { color: theme.accentText }]}>
                    开始阅读
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </RemoteImage>
        </Card>

        {/* 往期 */}
        <View style={styles.pastHeader}>
          <SectionHeader title="往期" theme={theme} />
          <TouchableOpacity style={styles.filterRow} hitSlop={8}>
            <Text style={{ color: theme.textSecondary, fontSize: 14 }}>筛选</Text>
            <Ionicons name="filter-outline" size={14} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>

        {pastArticles.map((a) => (
          <TouchableOpacity key={a.id} activeOpacity={0.8}>
            <Card theme={theme} style={styles.articleRow}>
              <RemoteImage uri={a.image} style={styles.articleThumb} />
              <View style={styles.articleInfo}>
                <View style={styles.articleMetaRow}>
                  <Ionicons name="bookmark-outline" size={12} color={theme.textMuted} />
                  <Text style={[styles.articleMeta, { color: theme.textMuted }]}>
                    {a.category}
                  </Text>
                  <Text style={[styles.articleMeta, { color: theme.textMuted }]}>
                    {a.dateLabel}
                  </Text>
                </View>
                <Text
                  style={[styles.articleTitle, { color: theme.text }]}
                  numberOfLines={2}>
                  {a.title}
                </Text>
                <Text
                  style={[styles.articleExcerpt, { color: theme.textSecondary }]}
                  numberOfLines={2}>
                  {a.excerpt}
                </Text>
                <View style={styles.articleFooter}>
                  <Chip label={a.level} color={theme.blue} bg={theme.accentSoft} />
                  <Text style={[styles.articleMeta, { color: theme.textMuted }]}>
                    {a.wordCount}词 · {a.minutes}分钟
                  </Text>
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 4 },
  topTabs: { flexDirection: 'row', justifyContent: 'center', gap: 36 },
  topTabItem: { alignItems: 'center' },
  topTabText: { fontSize: 17, fontWeight: weight('medium') },
  hotBadge: {
    position: 'absolute',
    top: -8,
    right: -28,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  hotText: { color: '#fff', fontSize: 9, fontWeight: weight('bold') },
  topTabUnderline: { height: 3, width: 22, borderRadius: 2, marginTop: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginTop: 12,
  },
  bannerTitle: { fontSize: 16, fontWeight: weight('semibold') },
  bannerSub: { fontSize: 12, marginTop: 2, letterSpacing: 2 },
  bannerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 12,
    gap: 2,
  },
  bannerButtonText: { fontSize: 13, fontWeight: weight('semibold') },
  todayTitle: { fontSize: 26, fontWeight: weight('bold'), marginTop: 24 },
  todayDate: { fontSize: 14, marginTop: 2, marginBottom: 12 },
  heroCard: { overflow: 'hidden' },
  heroImage: { height: 380, justifyContent: 'flex-end' },
  heroOverlay: {
    backgroundColor: 'rgba(0,0,0,0.42)',
    padding: 16,
    paddingTop: 28,
  },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMetaText: { color: '#E5E7EB', fontSize: 12 },
  heroTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: weight('bold'),
    lineHeight: 28,
    marginTop: 8,
  },
  heroBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  readersRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatarStack: { flexDirection: 'row' },
  miniAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  readersText: { color: '#E5E7EB', fontSize: 12 },
  startButton: {
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 9,
  },
  startButtonText: { fontSize: 14, fontWeight: weight('bold') },
  pastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  articleRow: { flexDirection: 'row', padding: 12, marginBottom: 12 },
  articleThumb: { width: 96, height: 96 },
  articleInfo: { flex: 1, marginLeft: 12 },
  articleMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  articleMeta: { fontSize: 12 },
  articleTitle: {
    fontSize: 15,
    fontWeight: weight('semibold'),
    lineHeight: 21,
    marginTop: 4,
  },
  articleExcerpt: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  articleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
});
