
import { EditorialAudioPlayer } from './EditorialAudioPlayer';
import { EditorialReadBadge } from '@/features/editorial/EditorialReadBadge';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { markTabBadge } from '@/components/tabIcons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import type { EditorialArticle } from '@/features/editorial/catalog';
import {
  isEditorialArticleShelved,
  setEditorialArticleShelved,
} from '@/features/shelf/editorialShelfStorage';

import { EditorialImage } from './EditorialImage';
import { EditorialRemoteStatus } from './EditorialRemoteStatus';
import { PUBLICATION_LOGOS } from './publicationLogo';
import { getChineseEditorialSummary, isChineseEditorialSummary } from './editorialSummary';
import { useEditorialArticle } from './useEditorialArticle';

type Props = { articleId: string };

export function EditorialOverviewScreen({ articleId }: Props) {
  const { article, loading, error, retry } = useEditorialArticle(articleId);
  return article ? (
    <EditorialOverviewContent key={article.id} article={article} />
  ) : loading || error ? (
    <EditorialRemoteStatus loading={loading} retry={retry} />
  ) : (
    <MissingEditorialArticleState />
  );
}

type ShelfState =
  | { status: 'loading'; shelved: false }
  | { status: 'ready'; shelved: boolean }
  | { status: 'saving'; shelved: boolean };

function EditorialOverviewContent({ article }: { article: EditorialArticle }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [shelfState, setShelfState] = useState<ShelfState>({
    status: 'loading',
    shelved: false,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [summaryState, setSummaryState] = useState<{
    value: string | null;
    loading: boolean;
    error: boolean;
  }>(() => ({
    value: isChineseEditorialSummary(article.summaryZh) ? article.summaryZh : null,
    loading: !isChineseEditorialSummary(article.summaryZh),
    error: false,
  }));
  const [summaryAttempt, setSummaryAttempt] = useState(0);

  useEffect(() => {
    if (isChineseEditorialSummary(article.summaryZh)) return;
    let active = true;
    void getChineseEditorialSummary(article.id, article.summaryZh)
      .then((value) => { if (active) setSummaryState({ value, loading: false, error: false }); })
      .catch(() => { if (active) setSummaryState({ value: null, loading: false, error: true }); });
    return () => { active = false; };
  }, [article.id, article.summaryZh, summaryAttempt]);

  useEffect(() => {
    let active = true;
    void isEditorialArticleShelved(article.id)
      .then((saved) => {
        if (active) setShelfState({ status: 'ready', shelved: saved });
      })
      .catch(() => {
        if (active) {
          setShelfState({ status: 'ready', shelved: false });
          setMessage('暂时无法更新书架，请重试');
        }
      });
    return () => {
      active = false;
    };
  }, [article.id]);

  useEffect(() => {
    if (message !== '已加入书架') return;
    const timeout = setTimeout(() => setMessage(null), 1_600);
    return () => clearTimeout(timeout);
  }, [message]);

  const toggleShelf = async () => {
    if (shelfState.status !== 'ready') return;
    const previousAdded = shelfState.shelved;
    const nextAdded = !previousAdded;
    setShelfState({ status: 'saving', shelved: previousAdded });
    setMessage(null);
    try {
      await setEditorialArticleShelved(article.id, nextAdded);
      setShelfState({ status: 'ready', shelved: nextAdded });
      if (nextAdded) { setMessage('已加入书架'); markTabBadge('shelf'); }
    } catch {
      setShelfState({ status: 'ready', shelved: previousAdded });
      setMessage('暂时无法更新书架，请重试');
    }
  };

  const pending = shelfState.status === 'loading' || shelfState.status === 'saving';
  const shelved = shelfState.shelved;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>平台外刊</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 120 },
        ]}>
        <EditorialImage uri={article.image} fallbackSource={PUBLICATION_LOGOS[article.source]}
          style={styles.cover} priority="high" />
        <View style={styles.coverMeta}>
          <Text style={[styles.coverSource, { color: theme.textMuted }]} numberOfLines={1}>{article.source.toUpperCase()} · {article.category}</Text>
          <TouchableOpacity
            onPress={() => void toggleShelf()}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel={shelved ? '移出书架' : '加入书架'}
            accessibilityState={{ disabled: pending, busy: pending }}
            hitSlop={8}
            style={styles.coverAction}>
            {pending ? <ActivityIndicator color={theme.textMuted} size="small" /> : null}
            <Text style={[styles.coverActionText, { color: shelved ? theme.textSecondary : theme.accent }]}>
              {shelved ? '✓ 已加入' : '加入书架'}
            </Text>
          </TouchableOpacity>
        </View>

        <EditorialReadBadge articleId={article.id} />
        <Text style={[styles.titleZh, { color: theme.text }]}>{article.titleZh}</Text>
        {article.titleEn !== article.titleZh ? (
          <Text style={[styles.titleEn, { color: theme.textSecondary }]}>{article.titleEn}</Text>
        ) : null}
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {article.wordCount} 词 · {article.minutes} 分钟 · {article.level}
        </Text>
        {article.audioAsset || article.audioUrl ? (
          <EditorialAudioPlayer articleId={article.id} title={article.titleZh} source={article.audioAsset ?? article.audioUrl!} />
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>文章概述</Text>
          <Text style={[styles.summary, { color: theme.textSecondary }]}>
            {summaryState.value ?? (summaryState.loading ? '中文概述加载中…' : '中文概述暂时无法加载')}
          </Text>
          {summaryState.error ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="重试中文概述"
              onPress={() => {
                setSummaryState({ value: null, loading: true, error: false });
                setSummaryAttempt((current) => current + 1);
              }}>
              <Text style={{ color: theme.accent }}>重试中文概述</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.pointsSection}>
          <Text style={[styles.sectionTitle, styles.pointsTitle, { color: theme.text }]}>你将读到</Text>
          {article.keyPointsZh.map((point) => (
            <View key={point} style={styles.pointRow}>
              <Text style={[styles.pointDash, { color: theme.textMuted }]}>—</Text>
              <Text style={[styles.point, { color: theme.text }]}>{point}</Text>
            </View>
          ))}
        </View>

        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.message,
              { color: message === '已加入书架' ? theme.success : theme.danger },
            ]}>
            {message}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.bottomAction,
          {
            backgroundColor: theme.bg,
            borderColor: theme.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}>
        <TouchableOpacity
          onPress={() =>
            router.push({
              pathname: '/editorial/[id]/read',
              params: { id: article.id },
            } as unknown as Parameters<typeof router.push>[0])
          }
          accessibilityRole="button"
          accessibilityLabel="开始阅读"
          style={[styles.startButton, { backgroundColor: theme.accent }]}>
          <Text style={[styles.startButtonText, { color: theme.accentText }]}>开始阅读</Text>
          <Ionicons name="arrow-forward" size={18} color={theme.accentText} />
        </TouchableOpacity>
      </View>
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
          <Text style={{ color: theme.accent }}>返回外刊</Text>
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
  content: { width: '100%', maxWidth: 760, alignSelf: 'center',  paddingHorizontal: 18, paddingTop: 12  },
  cover: { borderRadius: radius.content, height: 210 },
  coverMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, marginBottom: 18 },
  coverAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  coverActionText: { fontSize: 13, fontWeight: weight('semibold') },
  coverSource: { flex: 1, fontFamily: fonts.label, fontSize: 11, letterSpacing: 0.6 },
  titleZh: { fontSize: 26, fontWeight: weight('bold'), lineHeight: 34 },
  titleEn: { fontFamily: fonts.reading, fontSize: 17, lineHeight: 25, marginTop: 8 },
  meta: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 0.3, marginTop: 12 },
  section: { marginTop: 24, paddingBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: weight('bold') },
  summary: { fontSize: 15, lineHeight: 25, marginTop: 10 },
  pointsSection: { marginTop: 22 },
  pointsTitle: { marginBottom: 8 },
  pointRow: { flexDirection: 'row', gap: 10, paddingVertical: 7 },
  pointDash: { fontSize: 14, lineHeight: 22 },
  point: { flex: 1, fontSize: 15, lineHeight: 22 },
  message: { fontSize: 13, lineHeight: 20, marginTop: 18 },
  bottomAction: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    position: 'absolute',
    right: 0,
  },
  startButton: {
    alignItems: 'center',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  startButtonText: { fontSize: 15, fontWeight: weight('semibold') },
  missing: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center' },
  missingTitle: { fontSize: 18, fontWeight: weight('semibold') },
});
