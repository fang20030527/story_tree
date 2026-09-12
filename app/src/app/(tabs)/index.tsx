import { Ionicons } from '@expo/vector-icons';
import type { DashboardDto } from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { InstallationCredentialUnavailableError } from '@/api/installation';
import { getDashboard } from '@/api/practices';
import { Card, Chip, RemoteImage, SectionHeader } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  events,
  heroArticle,
  pastArticles,
  readingBooks,
  recommendedBooks,
  type ReadingEvent,
} from '@/data/mock';
import {
  clearActivePracticeId,
  loadActivePracticeId,
  saveActivePracticeId,
} from '@/features/practice/practiceStorage';
import {
  preferredResumePracticeId,
  resolvePracticeResume,
  type PracticeDestination,
} from '@/features/practice/resumePractice';

const TOP_TABS = ['文章', '书籍', '活动'];

function formatWordCount(count: number): string {
  return count >= 10000 ? `${(count / 10000).toFixed(1)}万` : `${count}`;
}

const EVENT_STATUS_STYLE: Record<
  ReadingEvent['status'],
  { cta: string; primary: boolean }
> = {
  报名中: { cta: '立即报名', primary: true },
  进行中: { cta: '进入活动', primary: true },
  已结束: { cta: '查看回放', primary: false },
};

function dashboardErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : '暂时无法同步练习进度';
}

function openPracticeDestination(
  practiceId: string,
  destination: Exclude<PracticeDestination, 'new'>,
) {
  router.push({
    pathname: `/practice/[id]/${destination}`,
    params: { id: practiceId },
  });
}

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [topTab, setTopTab] = useState('文章');
  const [dashboard, setDashboard] = useState<DashboardDto | null>(null);
  const [resumePracticeId, setResumePracticeId] = useState<string | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadDashboard = async () => {
        setCloudMessage(null);
        let localPracticeId: string | null = null;
        try {
          localPracticeId = await loadActivePracticeId();
        } catch {
          // Dashboard state still provides a durable fallback.
        }

        try {
          const nextDashboard = await getDashboard();
          if (!active) return;
          setDashboard(nextDashboard);
          setResumePracticeId(preferredResumePracticeId(
            localPracticeId,
            nextDashboard.incompletePracticeId,
          ));
        } catch (error) {
          if (!active) return;
          setResumePracticeId(localPracticeId);
          if (!(error instanceof InstallationCredentialUnavailableError)) {
            setCloudMessage(dashboardErrorMessage(error));
          }
        }
      };

      void loadDashboard();
      return () => {
        active = false;
      };
    }, []),
  );

  const openCloudPractice = async () => {
    setCloudMessage(null);
    if (!resumePracticeId) {
      router.push('/practice/new');
      return;
    }

    setResumeLoading(true);
    try {
      const resolved = await resolvePracticeResume(resumePracticeId);
      if (resolved.destination === 'new') {
        await clearActivePracticeId();
        router.push('/practice/new');
        return;
      }
      await saveActivePracticeId(resolved.practice.id);
      openPracticeDestination(resolved.practice.id, resolved.destination);
    } catch (error) {
      if (!(error instanceof InstallationCredentialUnavailableError)) {
        setCloudMessage(dashboardErrorMessage(error));
      }
    } finally {
      setResumeLoading(false);
    }
  };

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
        {topTab === '文章' ? (
          <>
            {/* 生词长文练习 banner */}
            <Card theme={theme} style={styles.banner}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: theme.text }]}>
              用你的生词生成长文练习
            </Text>
            <Text style={[styles.bannerSub, { color: theme.textMuted }]}>
              1–10 个具体义项
            </Text>
            {dashboard ? (
              <Text style={[styles.bannerQuota, { color: theme.textSecondary }]}>
                剩余 {dashboard.remainingFreePractices} 次免费练习
              </Text>
            ) : null}
            {cloudMessage ? (
              <Text style={[styles.bannerMessage, { color: theme.danger }]}>
                {cloudMessage}
              </Text>
            ) : null}
            <TouchableOpacity
              disabled={resumeLoading}
              onPress={() => void openCloudPractice()}
              style={[
                styles.bannerButton,
                {
                  backgroundColor: theme.accent,
                  opacity: resumeLoading ? 0.65 : 1,
                },
              ]}
              activeOpacity={0.85}>
              {resumeLoading ? (
                <ActivityIndicator color={theme.accentText} size="small" />
              ) : (
                <>
                  <Text style={[styles.bannerButtonText, { color: theme.accentText }]}>
                    {resumePracticeId ? '继续上次练习' : '录入词义'}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={theme.accentText}
                  />
                </>
              )}
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
          </>
        ) : null}

        {topTab === '书籍' ? (
          <>
            <View style={styles.sectionSpacer}>
              <SectionHeader title="在读" theme={theme} />
            </View>
            {readingBooks.map((b) => (
              <TouchableOpacity key={b.id} activeOpacity={0.8}>
                <Card theme={theme} style={styles.bookRow}>
                  <RemoteImage uri={b.cover} style={styles.bookCover} />
                  <View style={styles.bookInfo}>
                    <Text
                      style={[styles.bookTitle, { color: theme.text }]}
                      numberOfLines={1}>
                      {b.title}
                    </Text>
                    <Text
                      style={[styles.bookMeta, { color: theme.textMuted }]}
                      numberOfLines={1}>
                      {b.author}
                    </Text>
                    <Text
                      style={[styles.bookMeta, { color: theme.textSecondary }]}
                      numberOfLines={1}>
                      读至 {b.currentChapter}
                    </Text>
                    <View style={styles.progressRow}>
                      <View
                        style={[
                          styles.progressTrack,
                          { backgroundColor: theme.surfaceAlt },
                        ]}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              backgroundColor: theme.accent,
                              width: `${Math.round(b.progress * 100)}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.bookMeta, { color: theme.textMuted }]}>
                        {Math.round(b.progress * 100)}%
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={theme.textMuted}
                    style={styles.rowChevron}
                  />
                </Card>
              </TouchableOpacity>
            ))}

            <View style={styles.sectionSpacer}>
              <SectionHeader title="推荐书目" theme={theme} moreLabel="全部" />
            </View>
            {recommendedBooks.map((b) => (
              <TouchableOpacity key={b.id} activeOpacity={0.8}>
                <Card theme={theme} style={styles.bookRow}>
                  <RemoteImage uri={b.cover} style={styles.bookCover} />
                  <View style={styles.bookInfo}>
                    <Text
                      style={[styles.bookTitle, { color: theme.text }]}
                      numberOfLines={1}>
                      {b.title}
                    </Text>
                    <Text
                      style={[styles.bookMeta, { color: theme.textMuted }]}
                      numberOfLines={1}>
                      {b.author}
                    </Text>
                    <View style={styles.bookChipRow}>
                      <Chip label={b.category} color={theme.blue} bg={theme.accentSoft} />
                      <Chip label={b.level} color={theme.accentText} bg={theme.accent} />
                    </View>
                    <Text
                      style={[styles.bookMeta, { color: theme.textMuted }]}
                      numberOfLines={1}>
                      {b.chapters}章 · {formatWordCount(b.wordCount)}词 ·{' '}
                      {b.readers}人在读
                    </Text>
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </>
        ) : null}

        {topTab === '活动' ? (
          <>
            <View style={styles.sectionSpacer}>
              <SectionHeader title="近期活动" theme={theme} />
            </View>
            {events.map((e) => {
              const status = EVENT_STATUS_STYLE[e.status];
              return (
                <Card key={e.id} theme={theme} style={styles.eventCard}>
                  <RemoteImage uri={e.image} style={styles.eventImage}>
                    <View style={styles.eventBadgeRow}>
                      {e.hot ? (
                        <View
                          style={[
                            styles.eventBadge,
                            { backgroundColor: theme.danger },
                          ]}>
                          <Text style={styles.eventBadgeText}>HOT</Text>
                        </View>
                      ) : null}
                      <View
                        style={[
                          styles.eventBadge,
                          { backgroundColor: 'rgba(0,0,0,0.45)' },
                        ]}>
                        <Text style={styles.eventBadgeText}>{e.status}</Text>
                      </View>
                    </View>
                  </RemoteImage>
                  <View style={styles.eventBody}>
                    <Text
                      style={[styles.eventTitle, { color: theme.text }]}
                      numberOfLines={1}>
                      {e.title}
                    </Text>
                    <Text
                      style={[styles.eventDesc, { color: theme.textSecondary }]}
                      numberOfLines={2}>
                      {e.description}
                    </Text>
                    <View style={styles.eventMetaRow}>
                      <Ionicons
                        name="calendar-outline"
                        size={12}
                        color={theme.textMuted}
                      />
                      <Text style={[styles.eventMeta, { color: theme.textMuted }]}>
                        {e.dateLabel}
                      </Text>
                    </View>
                    <View style={styles.eventMetaRow}>
                      <Ionicons
                        name={
                          e.format === '线上' ? 'videocam-outline' : 'location-outline'
                        }
                        size={12}
                        color={theme.textMuted}
                      />
                      <Text style={[styles.eventMeta, { color: theme.textMuted }]}>
                        {e.format} · {e.location}
                      </Text>
                    </View>
                    <View style={styles.eventFooter}>
                      <Text style={[styles.eventMeta, { color: theme.textMuted }]}>
                        {e.participants}/{e.quota} 人已报名
                      </Text>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        style={[
                          styles.eventButton,
                          status.primary
                            ? { backgroundColor: theme.accent }
                            : {
                                backgroundColor: theme.surfaceAlt,
                                borderWidth: StyleSheet.hairlineWidth,
                                borderColor: theme.border,
                              },
                        ]}>
                        <Text
                          style={[
                            styles.eventButtonText,
                            {
                              color: status.primary
                                ? theme.accentText
                                : theme.textSecondary,
                            },
                          ]}>
                          {status.cta}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>
              );
            })}
          </>
        ) : null}
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
  bannerQuota: { fontSize: 12, marginTop: 8 },
  bannerMessage: { fontSize: 12, lineHeight: 17, marginTop: 8 },
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
  sectionSpacer: { marginTop: 20 },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 12,
  },
  bookCover: { width: 64, height: 84 },
  bookInfo: { flex: 1, marginLeft: 12 },
  bookTitle: { fontSize: 15, fontWeight: weight('semibold') },
  bookMeta: { fontSize: 12, marginTop: 3 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2 },
  rowChevron: { marginLeft: 8 },
  bookChipRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  eventCard: { marginBottom: 12, overflow: 'hidden' },
  eventImage: { height: 140, justifyContent: 'flex-start' },
  eventBadgeRow: { flexDirection: 'row', gap: 6, padding: 10 },
  eventBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  eventBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: weight('bold'),
  },
  eventBody: { padding: 12 },
  eventTitle: { fontSize: 15, fontWeight: weight('semibold') },
  eventDesc: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  eventMeta: { fontSize: 12 },
  eventFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  eventButton: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  eventButtonText: { fontSize: 12, fontWeight: weight('semibold') },
});
