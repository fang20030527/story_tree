import {
  MESSAGE_BOTTLE_CONTENT_LIMIT, MessageBottleReplyInputSchema, type MessageBottleModerationItem, type MessageBottleModerationView,
} from '@context-reader/contracts';
import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteMessageBottleReply, moderateMessageBottle, moderateMessageBottleAuthor, saveMessageBottleReply } from '@/api/messageBottleDeveloper';
import { confirmAction } from '@/components/confirm';
import { pageContent } from '@/components/ResponsiveFrame';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { DeveloperReply } from './DeveloperReply';
import { useMessageBottleModeration } from './useMessageBottleModeration';

const filters: { value: MessageBottleModerationView; label: string }[] = [
  { value: 'pending', label: '待审核' }, { value: 'reported', label: '被举报' },
  { value: 'hidden', label: '已隐藏' }, { value: 'recent', label: '全部留言' },
];
const statusLabels = { pending: '待审核', visible: '已公开', hidden: '已隐藏' };
const reasons = { spam: '垃圾广告', abuse: '辱骂骚扰', sexual: '色情低俗', illegal: '违法违规', other: '其他问题' };
function Button({ label, onPress, disabled = false, danger = false, selected }: {
  label: string; onPress: () => void; disabled?: boolean; danger?: boolean; selected?: boolean;
}) {
  const { theme } = useAppTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, {
      backgroundColor: selected ? theme.accent : theme.bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
    }]}>
    <Text style={{ color: selected ? theme.accentText : danger ? theme.danger : theme.accent, fontSize: 13 }}>{label}</Text>
  </Pressable>;
}

export function MessageBottleModeration({ onExit, onRevoke }: { onExit: () => void; onRevoke: () => void }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const feed = useMessageBottleModeration(onRevoke);
  const [editor, setEditor] = useState<{ id: string; content: string } | null>(null);
  const locked = feed.busy || feed.loading;
  const act = (run: () => Promise<unknown>, success: string) => { void feed.run(run, success); };
  const confirm = (title: string, message: string, label: string, run: () => Promise<unknown>, success: string) =>
    confirmAction({ title, message, confirmLabel: label, destructive: true }, () => act(run, success));
  const save = async () => {
    if (!editor) return;
    const parsed = MessageBottleReplyInputSchema.safeParse({ content: editor.content });
    if (!parsed.success) return;
    const done = await feed.run(() => saveMessageBottleReply(editor.id, parsed.data.content), '开发者回复已保存');
    if (done) setEditor(null);
  };
  const renderItem = ({ item }: { item: MessageBottleModerationItem }) => <View style={[styles.card, { backgroundColor: theme.surfaceAlt }]}>
    <View style={styles.row}>
      <Text style={[styles.author, { color: theme.text }]}>{item.username}</Text>
      <Text style={[styles.hint, { color: theme.textMuted }]}>{statusLabels[item.status]}{item.author.banned ? ' · 作者已禁言' : ''}</Text>
    </View>
    <Text style={[styles.hint, { color: theme.textMuted }]}>{new Date(item.createdAt).toLocaleString('zh-CN')}</Text>
    <Text selectable style={[styles.content, { color: theme.textSecondary }]}>{item.content}</Text>
    {item.reports.length > 0 ? <View style={styles.reports}>
      <Text style={[styles.hint, { color: theme.danger }]}>待处理举报 {item.reports.length} 次</Text>
      {item.reports.map((report, index) => <Text key={index} style={[styles.hint, { color: theme.textSecondary }]}>
        {reasons[report.reason]}{report.detail ? `：${report.detail}` : ''}
      </Text>)}
    </View> : null}
    {item.reply ? <DeveloperReply reply={item.reply} /> : null}
    <View style={styles.actions}>
      {item.status !== 'visible' || item.reports.length > 0 ? <Button label={item.status === 'visible' ? '驳回举报' : '通过并公开'} disabled={locked}
        onPress={() => act(() => moderateMessageBottle(item.id, 'approve'), '留言已通过审核')} /> : null}
      {item.status !== 'hidden' ? <Button label="隐藏留言" disabled={locked}
        onPress={() => act(() => moderateMessageBottle(item.id, 'hide'), '留言已隐藏')} /> : null}
      <Button label={item.reply ? '修改回复' : '回复留言'} disabled={locked} onPress={() => setEditor({ id: item.id, content: item.reply?.content ?? '' })} />
      {item.reply ? <Button label="删除回复" danger disabled={locked} onPress={() => confirm('删除开发者回复？', '原留言会保留，回复删除后无法恢复。', '删除回复',
        () => deleteMessageBottleReply(item.id), '开发者回复已删除')} /> : null}
      <Button label="删除留言" danger disabled={locked} onPress={() => confirm('永久删除这条留言？', '留言、开发者回复和相关举报都会删除，无法恢复。', '删除留言',
        () => moderateMessageBottle(item.id, 'delete'), '留言已删除')} />
      <Button label={item.author.banned ? '解除禁言' : '禁言作者'} danger={!item.author.banned} disabled={locked}
        onPress={() => item.author.banned
          ? act(() => moderateMessageBottleAuthor(item.author.id, 'unban'), '已解除禁言')
          : confirm(`禁言「${item.author.username ?? item.username}」？`, '对方将无法投递新留言，已有留言及其回复会一起隐藏。', '禁言',
            () => moderateMessageBottleAuthor(item.author.id, 'ban'), '作者已禁言，其留言已隐藏')} />
    </View>
    {editor?.id === item.id ? <View style={styles.editor}>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>回复显示在原留言下方；原留言通过审核后，大家才能看到。</Text>
      <TextInput accessibilityLabel="开发者回复内容" multiline value={editor.content} editable={!locked}
        onChangeText={content => setEditor({ id: item.id, content })} maxLength={MESSAGE_BOTTLE_CONTENT_LIMIT}
        placeholder="写下你的回复…" placeholderTextColor={theme.textMuted} textAlignVertical="top"
        style={[styles.input, { color: theme.text, backgroundColor: theme.bg }]} />
      <Text style={[styles.hint, { color: theme.textMuted }]}>{editor.content.length}/{MESSAGE_BOTTLE_CONTENT_LIMIT}</Text>
      {feed.actionError ? <Text accessibilityRole="alert" style={[styles.hint, { color: theme.danger }]}>{feed.actionError}</Text> : null}
      <View style={styles.actions}>
        <Button label="保存回复" disabled={locked || !MessageBottleReplyInputSchema.safeParse({ content: editor.content }).success} onPress={() => void save()} />
        <Button label="取消回复" disabled={locked} onPress={() => setEditor(null)} />
      </View>
    </View> : null}
  </View>;
  return <FlatList data={feed.items} renderItem={renderItem} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
    contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 28 }]}
    refreshControl={<RefreshControl refreshing={feed.loading} onRefresh={() => { if (!feed.busy) void feed.refresh(); }} tintColor={theme.accent} />}
    ListHeaderComponent={<View style={styles.header}>
      <View style={styles.row}><Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>开发者模式</Text>
        <Button label="返回所有留言" disabled={feed.busy} onPress={onExit} /></View>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>审核大家的想法，并以开发者身份回复。</Text>
      <View style={styles.actions}>{filters.map(filter => <Button key={filter.value} label={filter.label} selected={feed.view === filter.value}
        disabled={feed.busy} onPress={() => { setEditor(null); feed.setView(filter.value); }} />)}</View>
      <Button label="刷新审核列表" disabled={locked} onPress={() => void feed.refresh()} />
      {feed.notice ? <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.success }]}>{feed.notice}</Text> : null}
      {!editor && feed.actionError ? <Text accessibilityRole="alert" style={[styles.hint, { color: theme.danger }]}>{feed.actionError}</Text> : null}
      {feed.error ? <View style={styles.error}>
        <Text accessibilityRole="alert" style={[styles.hint, { color: theme.danger }]}>{feed.error}</Text>
        <Button label="重试读取审核留言" disabled={locked} onPress={() => void feed.refresh()} />
      </View> : null}
      {feed.busy ? <ActivityIndicator color={theme.accent} /> : null}
    </View>}
    ListEmptyComponent={feed.loading ? <ActivityIndicator color={theme.accent} /> : !feed.error
      ? <Text style={[styles.empty, { color: theme.textMuted }]}>这个分类下暂时没有留言。</Text> : null}
    ListFooterComponent={<View style={styles.footer}>{feed.loadingMore ? <ActivityIndicator color={theme.accent} /> : feed.nextCursor
      ? <Button label="加载更多审核留言" disabled={locked} onPress={() => void feed.loadMore()} /> : null}</View>} />;
}
const styles = StyleSheet.create({
  list: { ...pageContent, paddingTop: 18 }, header: { gap: 12, marginBottom: 18 },
  heading: { fontSize: 24, fontWeight: weight('semibold') }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  card: { borderRadius: 16, padding: 16, marginBottom: 12 }, author: { fontSize: 15, fontWeight: weight('semibold') },
  content: { fontSize: 15, lineHeight: 24, marginTop: 10 }, hint: { fontSize: 12, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }, reports: { gap: 4, marginTop: 10 },
  button: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  editor: { gap: 8, marginTop: 16 }, input: { minHeight: 112, borderRadius: 12, padding: 12, fontSize: 15, lineHeight: 24 },
  footer: { paddingVertical: 20, alignItems: 'center' }, empty: { fontSize: 14, paddingVertical: 28, textAlign: 'center' }, error: { gap: 8 },
});
