import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SectionHeader } from '@/components/ui';
import { radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  editorialHasOriginalAudio,
  getEditorialSection,
  getFeaturedEditorialArticle,
  type EditorialArticle,
} from './catalog';
import { useRemoteEditorialCatalogVersion } from './remoteCatalog';
import { PUBLICATION_LOGOS } from './publicationLogo';

const PAGE_SIZE = 24;

export function FeaturedLibrary({ renderArticle, onNavigate, filterTopic = '全部', filterSource = '全部刊物', filterYear = '全部年份' }: {
  renderArticle: (article: EditorialArticle) => React.ReactNode;
  onNavigate: () => void;
  filterTopic?: string;
  filterSource?: string;
  filterYear?: string;
}) {
  const { theme } = useAppTheme();
  const [source, setSource] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [originalOnly, setOriginalOnly] = useState(false);
  const catalogVersion = useRemoteEditorialCatalogVersion();
  const selectedArticle = getFeaturedEditorialArticle();
  const publications = useMemo(() => {
    const groups = new Map<string, Map<string, EditorialArticle[]>>();
    for (const article of getEditorialSection('featured')) {
      if (filterTopic !== '全部' && article.category !== filterTopic) continue;
      if (filterSource !== '全部刊物' && article.source !== filterSource) continue;
      if (filterYear !== '全部年份' && !(article.issueDate ?? article.publishedAt).startsWith(filterYear)) continue;
      if (originalOnly && !editorialHasOriginalAudio(article)) continue;
      const issues = groups.get(article.source) ?? new Map<string, EditorialArticle[]>();
      const displayDate = article.issueDate ?? article.publishedAt;
      const articles = issues.get(displayDate) ?? [];
      articles.push(article);
      issues.set(displayDate, articles);
      groups.set(article.source, issues);
    }
    return groups;
  }, [catalogVersion, originalOnly, filterTopic, filterSource, filterYear]);
  const issues = source ? publications.get(source) : undefined;
  const sourceArticles = [...(issues?.values() ?? [])].flat();
  const browseByIssue = sourceArticles.some((article) => article.issueDate);
  const showArticles = source !== null && (date !== null || !browseByIssue);
  const articles = date ? issues?.get(date) ?? [] : sourceArticles;
  const dates = [...(issues?.keys() ?? [])].sort((a, b) => b.localeCompare(a));
  const pageCount = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  const context = !source ? '选择外刊，浏览文章或按日期查看期刊'
    : !showArticles ? `${source} / 选择日期`
    : `${source}${date ? ` / ${date}` : ''} · 共 ${articles.length} 篇`;

  const navigate = (nextSource: string | null, nextDate: string | null) => {
    setSource(nextSource);
    setDate(nextDate);
    setPage(0);
    onNavigate();
  };
  const toggleOriginalOnly = () => {
    setOriginalOnly((current) => !current);
    navigate(null, null);
  };
  const categoryRow = (label: string, detail: string, onPress: () => void) => (
    <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={`查看${label}`}
      onPress={onPress} style={[styles.row, { backgroundColor: theme.surfaceAlt }]}>
      {!source && PUBLICATION_LOGOS[label] ? (
        <View style={styles.logoFrame}>
          <Image source={PUBLICATION_LOGOS[label]} style={styles.logo} contentFit="contain"
            accessibilityLabel={`${label} 标识`} />
        </View>
      ) : (
        <Ionicons name={source ? 'calendar-outline' : 'book-outline'} size={22} color={theme.accent} />
      )}
      <View style={styles.info}>
        <Text style={[styles.title, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.detail, { color: theme.textMuted }]}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </TouchableOpacity>
  );

  return (
    <View>
      <SectionHeader title="精选外刊" theme={theme} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="只看原刊录音"
        accessibilityState={{ selected: originalOnly }} onPress={toggleOriginalOnly}
        style={[styles.audioFilter, {
          backgroundColor: originalOnly ? theme.accentSoft : theme.surfaceAlt,
        }]}>
        <Ionicons name="headset-outline" size={17} color={originalOnly ? theme.accent : theme.textMuted} />
        <Text style={{ color: originalOnly ? theme.accent : theme.text }}>只看原刊录音</Text>
      </TouchableOpacity>
      {selectedArticle && !source && !originalOnly && filterTopic === '全部' && filterSource === '全部刊物' && filterYear === '全部年份' ? (
        <View style={styles.selected}>
          <Text style={[styles.selectedLabel, { color: theme.textMuted }]}>本期精选</Text>
          {renderArticle(selectedArticle)}
        </View>
      ) : null}
      {source ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={date ? '返回日期分类' : '返回外刊分类'}
          onPress={() => navigate(date ? source : null, null)} style={styles.back}>
          <Ionicons name="chevron-back" size={17} color={theme.accent} />
          <Text style={{ color: theme.accent }}>{date ? '返回日期分类' : '返回外刊分类'}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={[styles.context, { color: theme.textMuted }]}>
        {context}
      </Text>
      <View style={styles.list}>
        {!source ? [...publications].map(([name, entries]) => {
          const items = [...entries.values()].flat();
          const dateCount = items.some((article) => article.issueDate) ? `${entries.size} 个日期 · ` : '';
          return categoryRow(name, `${dateCount}${items.length} 篇`, () => navigate(name, null));
        }) : !showArticles ? dates.map((value) => categoryRow(
          value, `${issues!.get(value)!.length} 篇文章`, () => navigate(source, value),
        )) : articles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(renderArticle)}
      </View>
      {showArticles && pageCount > 1 ? (
        <View style={styles.pagination}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="上一页" disabled={page === 0}
            style={styles.pageButton} onPress={() => { setPage(page - 1); onNavigate(); }}>
            <Text style={{ color: page === 0 ? theme.textMuted : theme.accent }}>上一页</Text>
          </TouchableOpacity>
          <Text style={{ color: theme.textMuted }}>第 {page + 1} / {pageCount} 页</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="下一页" disabled={page + 1 >= pageCount}
            style={styles.pageButton} onPress={() => { setPage(page + 1); onNavigate(); }}>
            <Text style={{ color: page + 1 >= pageCount ? theme.textMuted : theme.accent }}>下一页</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  audioFilter: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, marginBottom: 14 },
  selected: { marginBottom: 18 },
  selectedLabel: { fontSize: 13, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, },
  info: { flex: 1 },
  logoFrame: { width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 6 },
  logo: { width: 36, height: 36 },
  title: { fontSize: 16, fontWeight: weight('semibold') },
  detail: { fontSize: 12, marginTop: 6 },
  context: { fontSize: 13, marginBottom: 14 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, marginBottom: 4, alignSelf: 'flex-start' },
  list: { gap: 10, marginBottom: 22 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  pageButton: { padding: 12 },
});
