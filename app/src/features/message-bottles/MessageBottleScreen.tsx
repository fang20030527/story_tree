import { Ionicons } from '@expo/vector-icons';
import { CreateMessageBottleSchema, MESSAGE_BOTTLE_CONTENT_LIMIT, type MessageBottleDto } from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createIdempotencyKey } from '@/api/installation';
import { BrandHeader, PageHeading } from '@/components/brand';
import { pageContent } from '@/components/ResponsiveFrame';
import { radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { messageBottleError, useMessageBottles } from './useMessageBottles';

export function MessageBottleScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const feed = useMessageBottles();
  const [username, setUsername] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const sendingRef = useRef(false);
  const scope = useRef(0);
  const active = useRef(false);
  useFocusEffect(useCallback(() => {
    active.current = true; ++scope.current; sendingRef.current = false; setSending(false);
    return () => { active.current = false; ++scope.current; };
  }, []));
  const author = feed.profile?.username ?? username;
  const parsed = CreateMessageBottleSchema.safeParse({ username: author, content });
  const disabled = sending || !feed.profile?.canPost || !parsed.success;

  const submit = async () => {
    if (sendingRef.current || disabled || !parsed.success) return;
    const currentScope = scope.current;
    sendingRef.current = true; setSending(true); setSendError(null); setNotice(null);
    try {
      const signature = JSON.stringify(parsed.data);
      if (pending.current?.signature !== signature) {
        const key = await createIdempotencyKey();
        if (!active.current || scope.current !== currentScope) return;
        pending.current = { signature, key };
      }
      await feed.post(parsed.data, pending.current!.key);
      if (!active.current || scope.current !== currentScope) return;
      pending.current = null; setContent(''); setNotice('留言已投递，谢谢你的反馈。');
    } catch (cause) {
      if (active.current && scope.current === currentScope) setSendError(messageBottleError(cause, '留言投递失败，请稍后重试'));
    } finally {
      if (active.current && scope.current === currentScope) { sendingRef.current = false; setSending(false); }
    }
  };

  const action = (label: string, onPress: () => void, isDisabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: isDisabled }} disabled={isDisabled} onPress={onPress}
    style={({ pressed }) => [styles.smallButton, { borderColor: theme.border, opacity: isDisabled ? 0.5 : pressed ? 0.65 : 1 }]}>
    <Text style={{ color: theme.accent, fontSize: 13 }}>{label}</Text>
  </Pressable>;

  const header = <>
    <View style={styles.headingRow}>
      <View style={styles.headingCopy}><PageHeading title="留言瓶" description="把想法装进瓶子，让黑洞英语变得更好。" /></View>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bottleArt}>
        <View style={[styles.bottleNeck, { borderColor: theme.accent, backgroundColor: theme.accentSoft }]} />
        <View style={[styles.bottleBody, { borderColor: theme.accent, backgroundColor: theme.accentSoft }]}>
          <View style={[styles.note, { backgroundColor: theme.surface }]}><View style={[styles.noteLine, { backgroundColor: theme.pink }]} /><View style={[styles.noteLine, { backgroundColor: theme.pink, width: 12 }]} /></View>
        </View>
      </View>
    </View>
    {feed.profile?.canPost ? <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>投递你的想法</Text>
      {feed.profile.username ? <View style={styles.authorRow}><Text style={[styles.hint, { color: theme.textMuted }]}>公开署名</Text><Text style={[styles.author, { color: theme.text }]}>{feed.profile.username}</Text></View> : <>
        <Text style={[styles.label, { color: theme.textSecondary }]}>用户名</Text>
        <TextInput accessibilityLabel="用户名" value={username} editable={!sending} onChangeText={value => { setUsername(value); setSendError(null); }}
          maxLength={24} autoCapitalize="none" autoCorrect={false} placeholder="你的公开用户名" placeholderTextColor={theme.textMuted}
          style={[styles.usernameInput, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]} />
        <Text style={[styles.hint, { color: theme.textMuted }]}>2–24 字，可用中英文、数字和下划线。设置后用于所有留言。</Text>
      </>}
      <TextInput accessibilityLabel="留言内容" multiline value={content} editable={!sending} onChangeText={value => { setContent(value); setSendError(null); setNotice(null); }}
        maxLength={MESSAGE_BOTTLE_CONTENT_LIMIT} placeholder="哪里还不够顺手？你希望增加什么功能？" placeholderTextColor={theme.textMuted}
        textAlignVertical="top" style={[styles.contentInput, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]} />
      <View style={styles.countRow}><Text style={[styles.hint, { color: theme.textMuted }]}>留言与用户名会公开给所有人。</Text><Text style={[styles.hint, { color: theme.textMuted }]}>{content.length}/{MESSAGE_BOTTLE_CONTENT_LIMIT}</Text></View>
      {sendError ? <Text accessibilityRole="alert" style={[styles.feedback, { color: theme.danger }]}>{sendError}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: theme.success }]}>{notice}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="投递留言" accessibilityState={{ disabled, busy: sending }} disabled={disabled}
        onPress={() => void submit()} style={({ pressed }) => [styles.submit, { backgroundColor: theme.accent, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}>
        {sending ? <ActivityIndicator size="small" color={theme.accentText} /> : <Ionicons name="paper-plane-outline" size={17} color={theme.accentText} />}
        <Text style={[styles.submitText, { color: theme.accentText }]}>{sending ? '正在投递…' : '投递留言'}</Text>
      </Pressable>
    </View> : feed.profile ? <View style={[styles.loginCard, { backgroundColor: theme.surfaceAlt }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>留下名字，也留下你的想法。</Text>
      <Text style={[styles.loginHint, { color: theme.textSecondary }]}>登录后以用户名投递意见，和大家一起让黑洞英语更好用。</Text>
      {action('登录后投递留言', () => router.push('/login'))}
    </View> : feed.profileError ? <View style={styles.state}>
      <Text style={[styles.hint, { color: theme.danger }]}>{feed.profileError}</Text>{action('重试读取账号', () => void feed.refresh(), feed.refreshing)}
    </View> : <ActivityIndicator color={theme.accent} style={styles.loading} />}
    <View style={[styles.listHeading, { borderBottomColor: theme.text }]}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>所有留言</Text>
      {action('刷新留言', () => void feed.refresh(), feed.refreshing || sending)}
    </View>
    {feed.error ? <View style={styles.state}><Text style={[styles.hint, { color: theme.danger }]}>{feed.error}</Text>{action('重试读取留言', () => void feed.refresh(), feed.refreshing)}</View> : null}
  </>;

  const renderMessage = ({ item }: { item: MessageBottleDto }) => <View style={[styles.message, { borderBottomColor: theme.border }]}>
    <View style={styles.messageMeta}><View style={styles.messageAuthor}><Text style={[styles.author, { color: theme.text }]}>{item.username}</Text>
      {item.isMine ? <Text style={[styles.mine, { color: theme.accent, backgroundColor: theme.accentSoft }]}>我</Text> : null}</View>
      <Text style={[styles.time, { color: theme.textMuted }]}>{new Date(item.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</Text>
    </View>
    <Text selectable style={[styles.messageContent, { color: theme.textSecondary }]}>{item.content}</Text>
  </View>;

  return <KeyboardAvoidingView style={[styles.screen, { backgroundColor: theme.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <BrandHeader />
    <FlatList data={feed.items} renderItem={renderMessage} keyExtractor={item => item.id} ListHeaderComponent={header}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(28, insets.bottom + 16) }]} showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => void feed.refresh()} tintColor={theme.accent} colors={[theme.accent]} />}
      ListEmptyComponent={feed.refreshing ? <ActivityIndicator color={theme.accent} style={styles.loading} /> : !feed.error ? <Text style={[styles.empty, { color: theme.textMuted }]}>还没有留言，来投递第一只留言瓶吧。</Text> : null}
      ListFooterComponent={<View style={styles.footer}>
        {feed.moreError ? <Text style={[styles.hint, { color: theme.danger }]}>{feed.moreError}</Text> : null}
        {feed.loadingMore ? <ActivityIndicator color={theme.accent} /> : feed.nextCursor ? action(feed.moreError ? '重试加载' : '加载更多留言', () => void feed.loadMore(), feed.refreshing)
          : feed.items.length > 0 && !feed.error ? <Text style={[styles.hint, { color: theme.textMuted }]}>已经看到所有留言</Text> : null}
      </View>} />
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { ...pageContent, paddingTop: 12 }, headingRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  headingCopy: { flex: 1 }, bottleArt: { width: 50, height: 76, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '12deg' }] },
  bottleNeck: { width: 17, height: 16, borderWidth: 1.5, borderTopLeftRadius: 3, borderTopRightRadius: 3, marginBottom: -2 },
  bottleBody: { width: 40, height: 48, borderWidth: 1.5, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, alignItems: 'center', justifyContent: 'center' },
  note: { width: 24, height: 22, padding: 5, gap: 4, transform: [{ rotate: '-18deg' }] }, noteLine: { width: 16, height: 2 },
  composer: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.content, padding: 18 }, sectionTitle: { fontSize: 18, fontWeight: weight('semibold'), lineHeight: 26 },
  label: { fontSize: 13, marginTop: 16 }, usernameInput: { borderWidth: 1, borderRadius: radius.content, minHeight: 46, paddingHorizontal: 12, fontSize: 15, marginTop: 8, marginBottom: 8 },
  hint: { fontSize: 12, lineHeight: 19 }, authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  author: { fontSize: 14, fontWeight: weight('semibold'), flexShrink: 1 }, contentInput: { borderWidth: 1, borderRadius: radius.content, minHeight: 128, padding: 12, fontSize: 15, lineHeight: 24, marginTop: 16 },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 9 },
  submit: { alignSelf: 'flex-start', borderRadius: radius.pill, minHeight: 46, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }, submitText: { fontSize: 14, fontWeight: weight('semibold') },
  feedback: { fontSize: 13, lineHeight: 20, marginTop: 10 }, loginCard: { padding: 18, gap: 12, borderRadius: radius.content }, loginHint: { fontSize: 13, lineHeight: 21 },
  smallButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill },
  listHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, paddingBottom: 8, marginTop: 32 },
  message: { paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth }, messageMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  messageAuthor: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 8 }, mine: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, fontSize: 11 }, time: { fontSize: 11 },
  messageContent: { fontSize: 15, lineHeight: 25, marginTop: 10 }, loading: { marginVertical: 22 }, empty: { fontSize: 14, lineHeight: 22, textAlign: 'center', paddingVertical: 38 },
  state: { gap: 12, paddingVertical: 20 }, footer: { paddingVertical: 24, alignItems: 'center', gap: 12 },
});
