import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SectionHeader } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { getEditorialSection, type EditorialArticle } from './catalog';

const PAGE_SIZE = 24;
const UNDATED = '日期未标注';

export function FeaturedLibrary({ renderArticle, onNavigate }: {
  renderArticle: (article: EditorialArticle) => React.ReactNode;
  onNavigate: () => void;
}) {
  const { theme } = useAppTheme();
  const [source, setSource] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const publications = useMemo(() => {
    const groups = new Map<string, Map<string, EditorialArticle[]>>();
    for (const article of getEditorialSection('featured')) {
      const issues = groups.get(article.source) ?? new Map<string, EditorialArticle[]>();
      const issueDate = article.issueDate || UNDATED;
      const articles = issues.get(issueDate) ?? [];
      articles.push(article);
      issues.set(issueDate, articles);
      groups.set(article.source, issues);
    }
    return groups;
  }, []);
  const issues = source ? publications.get(source) : undefined;
  const articles = date ? issues?.get(date) ?? [] : [];
  const dates = [...(issues?.keys() ?? [])].sort((a, b) =>
    a === b ? 0 : a === UNDATED ? 1 : b === UNDATED ? -1 : b.localeCompare(a));
  const pageCount = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));

  const navigate = (nextSource: string | null, nextDate: string | null) => {
    setSource(nextSource);
    setDate(nextDate);
    setPage(0);
    onNavigate();
  };
  const categoryRow = (label: string, detail: string, onPress: () => void) => (
    <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={`查看${label}`}
      onPress={onPress} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Ionicons name={source ? 'calendar-outline' : 'book-outline'} size={22} color={theme.blue} />
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth },
  info: { flex: 1 },
  title: { fontSize: 16, fontWeight: weight('semibold') },
  detail: { fontSize: 12, marginTop: 6 },
  context: { fontSize: 13, marginBottom: 14 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, marginBottom: 4, alignSelf: 'flex-start' },
  list: { gap: 10, marginBottom: 22 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  pageButton: { padding: 12 },
});
