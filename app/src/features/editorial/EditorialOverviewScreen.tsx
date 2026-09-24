import { EditorialAudioPlayer } from './EditorialAudioPlayer';
import { EditorialSpeechPlayer } from './EditorialSpeechPlayer';
import { EditorialReadBadge } from '@/features/editorial/EditorialReadBadge';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
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

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import type { EditorialArticle } from '@/features/editorial/catalog';
import {
  isEditorialArticleShelved,
  setEditorialArticleShelved,
} from '@/features/shelf/editorialShelfStorage';

import { EditorialImage } from './EditorialImage';
import { EditorialRemoteStatus } from './EditorialRemoteStatus';
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
      if (nextAdded) setMessage('已加入书架');
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
        <EditorialImage uri={article.image} style={styles.cover} priority="high">
          <View style={styles.coverShade} />
          <View style={styles.coverActionWrap}>
            <TouchableOpacity
              onPress={() => void toggleShelf()}
              disabled={pending}
              accessibilityRole="button"
              accessibilityLabel={shelved ? '移出书架' : '加入书架'}
              accessibilityState={{ disabled: pending, busy: pending }}
              style={[
                styles.coverAction,
                { backgroundColor: shelved ? theme.accent : theme.surface },
              ]}>
              {pending ? <ActivityIndicator color={theme.text} size="small" /> : null}
              <Text
                style={[
                  styles.coverActionText,
                  { color: shelved ? theme.accentText : theme.text },
                ]}>
                {shelved ? '✓ 已加入' : '加入书架'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.coverCaption}>
            <Text style={styles.coverSource}>{article.source}</Text>
            <Text style={styles.coverCategory}>{article.category}</Text>
          </View>
        </EditorialImage>

        <EditorialReadBadge articleId={article.id} />
        <Text style={[styles.titleZh, { color: theme.text }]}>{article.titleZh}</Text>
        {article.titleEn !== article.titleZh ? (
          <Text style={[styles.titleEn, { color: theme.textSecondary }]}>{article.titleEn}</Text>
        ) : null}
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {article.wordCount} 词 · {article.minutes} 分钟 · {article.level}
        </Text>
        {article.audioAsset || article.audioUrl ? (
          <EditorialAudioPlayer source={article.audioUrl ?? article.audioAsset!} />
        ) : article.wordCount > 0 ? (
          <EditorialSpeechPlayer loadText={() => article.paragraphs} />
        ) : null}

        <View style={[styles.section, { borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>文章概述</Text>
          <Text style={[styles.summary, { color: theme.textSecondary }]}>{article.summaryZh}</Text>
        </View>

        <View style={styles.pointsSection}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>你将读到</Text>
          {article.keyPointsZh.map((point) => (
            <View key={point} style={styles.pointRow}>
              <Ionicons name="checkmark-circle" size={18} color={theme.accent} />
              <Text style={[styles.point, { color: theme.textSecondary }]}>{point}</Text>
            </View>
          ))}
        </View>

        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.message,
              { color: message === '已加入书架' ? theme.green : theme.danger },
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
  content: { paddingHorizontal: 18, paddingTop: 12 },
  cover: { borderRadius: 16, height: 210, marginBottom: 20 },
  coverShade: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  coverActionWrap: { alignItems: 'flex-end', padding: 12 },
  coverAction: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  coverActionText: { fontSize: 12, fontWeight: weight('semibold') },
  coverCaption: { bottom: 14, left: 14, position: 'absolute' },
  coverSource: { color: '#FFFFFF', fontSize: 13, fontWeight: weight('semibold') },
  coverCategory: { color: 'rgba(255,255,255,0.82)', fontSize: 11, marginTop: 3 },
  titleZh: { fontSize: 26, fontWeight: weight('bold'), lineHeight: 34 },
  titleEn: { fontSize: 16, lineHeight: 24, marginTop: 8 },
  meta: { fontSize: 12, marginTop: 10 },
  section: { borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 24, paddingBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: weight('semibold') },
  summary: { fontSize: 15, lineHeight: 25, marginTop: 10 },
  pointsSection: { gap: 11, marginTop: 22 },
  pointRow: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  point: { flex: 1, fontSize: 14, lineHeight: 21 },
  message: { fontSize: 13, lineHeight: 20, marginTop: 18 },
  bottomAction: {
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    position: 'absolute',
    right: 0,
  },
  startButton: {
    alignItems: 'center',
    borderRadius: 13,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  startButtonText: { fontSize: 15, fontWeight: weight('semibold') },
  missing: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center' },
  missingTitle: { fontSize: 18, fontWeight: weight('semibold') },
});
