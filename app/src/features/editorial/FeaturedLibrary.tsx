import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SectionHeader } from '@/components/ui';
import { weight } from '@/constants/theme';
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

export function FeaturedLibrary({ renderArticle, onNavigate }: {
  renderArticle: (article: EditorialArticle) => React.ReactNode;
  onNavigate: () => void;
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
      if (originalOnly && !editorialHasOriginalAudio(article)) continue;
      const issues = groups.get(article.source) ?? new Map<string, EditorialArticle[]>();
      const displayDate = article.issueDate ?? article.publishedAt;
      const articles = issues.get(displayDate) ?? [];
      articles.push(article);
      issues.set(displayDate, articles);
      groups.set(article.source, issues);
    }
    return groups;
  }, [catalogVersion, originalOnly]);
  const issues = source ? publications.get(source) : undefined;
  const articles = date ? issues?.get(date) ?? [] : [];
  const dates = [...(issues?.keys() ?? [])].sort((a, b) => b.localeCompare(a));
  const pageCount = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));

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
      onPress={onPress} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {!source && PUBLICATION_LOGOS[label] ? (
        <View style={styles.logoFrame}>
          <Image source={PUBLICATION_LOGOS[label]} style={styles.logo} contentFit="contain"
            accessibilityLabel={`${label} 标识`} />
        </View>
      ) : (
        <Ionicons name={source ? 'calendar-outline' : 'book-outline'} size={22} color={theme.blue} />
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
          backgroundColor: originalOnly ? theme.surfaceAlt : theme.surface,
          borderColor: originalOnly ? theme.blue : theme.border,
        }]}>
        <Ionicons name="headset-outline" size={17} color={originalOnly ? theme.blue : theme.textMuted} />
        <Text style={{ color: originalOnly ? theme.blue : theme.text }}>只看原刊录音</Text>
      </TouchableOpacity>
      {selectedArticle && !source && !originalOnly ? (
        <View style={styles.selected}>
          <Text style={[styles.selectedLabel, { color: theme.textMuted }]}>本期精选</Text>
          {renderArticle(selectedArticle)}
        </View>
      ) : null}
      {source ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={date ? '返回日期分类' : '返回外刊分类'}
          onPress={() => navigate(date ? source : null, null)} style={styles.back}>
          <Ionicons name="chevron-back" size={17} color={theme.blue} />
          <Text style={{ color: theme.blue }}>{date ? '返回日期分类' : '返回外刊分类'}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={[styles.context, { color: theme.textMuted }]}>
        {source ? `${source}${date ? ` / ${date} · 共 ${articles.length} 篇` : ' / 选择日期'}` : '选择外刊，再按日期浏览文章'}
      </Text>
      <View style={styles.list}>
        {!source ? [...publications].map(([name, entries]) => categoryRow(
          name, `${entries.size} 个日期 · ${[...entries.values()].reduce((count, items) => count + items.length, 0)} 篇`,
          () => navigate(name, null),
        )) : !date ? dates.map((value) => categoryRow(
          value, `${issues!.get(value)!.length} 篇文章`, () => navigate(source, value),
        )) : articles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(renderArticle)}
      </View>
      {date && pageCount > 1 ? (
        <View style={styles.pagination}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="上一页" disabled={page === 0}
            style={styles.pageButton} onPress={() => { setPage(page - 1); onNavigate(); }}>
            <Text style={{ color: page === 0 ? theme.textMuted : theme.blue }}>上一页</Text>
          </TouchableOpacity>
          <Text style={{ color: theme.textMuted }}>第 {page + 1} / {pageCount} 页</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="下一页" disabled={page + 1 >= pageCount}
            style={styles.pageButton} onPress={() => { setPage(page + 1); onNavigate(); }}>
            <Text style={{ color: page + 1 >= pageCount ? theme.textMuted : theme.blue }}>下一页</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  audioFilter: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderRadius: 12, marginBottom: 14 },
  selected: { marginBottom: 18 },
  selectedLabel: { fontSize: 13, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth },
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
