import { Ionicons } from '@expo/vector-icons';
import {
  CreateMessageBottleSchema, MESSAGE_BOTTLE_CONTENT_LIMIT, type MessageBottleReportReason, type MessageBottleThreadDto,
} from '@context-reader/contracts';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlackHoleLoader, Bottle, EnterOnce } from '@/components/cosmos';
import { motionAllowedNow } from '@/components/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createIdempotencyKey } from '@/api/installation';
import { BrandHeader, PageHeading } from '@/components/brand';
import { confirmAction, notify } from '@/components/confirm';
import { ListGroup, ListRow, SheetFrame } from '@/components/subpage';
import { pageContent } from '@/components/ResponsiveFrame';
import { motion, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { messageBottleError, useMessageBottles } from './useMessageBottles';
import { DeveloperReply } from './DeveloperReply';
import { MessageBottleModeration } from './MessageBottleModeration';

const REPORT_REASONS: { reason: MessageBottleReportReason; label: string }[] = [
  { reason: 'spam', label: '垃圾广告' }, { reason: 'abuse', label: '辱骂骚扰' }, { reason: 'sexual', label: '色情低俗' },
  { reason: 'illegal', label: '违法违规' }, { reason: 'other', label: '其他问题' },
];

export function MessageBottleScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const feed = useMessageBottles();
  const [developerMode, setDeveloperMode] = useState(false);
  const [username, setUsername] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const [menu, setMenu] = useState<{ item: MessageBottleThreadDto; step: 'menu' | 'report' } | null>(null);
  const [acting, setActing] = useState(false);
  const sendingRef = useRef(false);
  const scope = useRef(0);
  const active = useRef(false);
  useFocusEffect(useCallback(() => {
    active.current = true; ++scope.current; sendingRef.current = false; setSending(false); setDeveloperMode(false); setMenu(null);
    return () => { active.current = false; ++scope.current; };
  }, []));
  // 投递成功：标题旁的漂流瓶沿虚线轨道漂出画面（820ms 加速），再淡入回到原处。
  const [drift] = useState(() => new Animated.Value(0));
  const sendOff = () => {
    if (!motionAllowedNow()) return;
    drift.setValue(0);
    Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 820, easing: motion.easeIn, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(drift, { toValue: 2, duration: 240, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }),
    ]).start(() => drift.setValue(0));
  };
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
      const message = await feed.post(parsed.data, pending.current!.key);
      if (!active.current || scope.current !== currentScope) return;
      pending.current = null; setContent('');
      setNotice(message.status === 'pending' ? '留言已提交，审核通过后所有人都能看到。' : '留言已投递，谢谢你的反馈。'); sendOff();
    } catch (cause) {
      if (active.current && scope.current === currentScope) setSendError(messageBottleError(cause, '留言投递失败，请稍后重试'));
    } finally {
      if (active.current && scope.current === currentScope) { sendingRef.current = false; setSending(false); }
    }
  };

  const action = (label: string, onPress: () => void, isDisabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: isDisabled }} disabled={isDisabled} onPress={onPress}
    style={({ pressed }) => [styles.smallButton, { backgroundColor: theme.accentSoft, opacity: isDisabled ? 0.5 : pressed ? 0.86 : 1 }]}>
    <Text style={{ color: theme.accent, fontSize: 13 }}>{label}</Text>
  </Pressable>;

  const header = <>
    {feed.canModerate ? <View style={{ marginBottom: 12 }}>{action('开发者模式', () => setDeveloperMode(true))}</View> : null}
    {feed.accessError ? <Text style={[styles.hint, { color: theme.textMuted }]}>{feed.accessError}</Text> : null}
    <View style={styles.headingRow}>
      <View style={styles.headingCopy}><PageHeading title="留言瓶" description="把想法装进瓶子，让黑洞英语变得更好。" /></View>
      <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.bottleArt, {
        opacity: drift.interpolate({ inputRange: [0, 0.8, 1, 1.01, 2], outputRange: [1, 1, 0, 0, 1] }),
        transform: [
          { translateX: drift.interpolate({ inputRange: [0, 1, 1.01, 2], outputRange: [0, 110, 0, 0] }) },
          { translateY: drift.interpolate({ inputRange: [0, 1, 1.01, 2], outputRange: [0, 40, 0, 0] }) },
          { scale: drift.interpolate({ inputRange: [0, 1, 1.01, 2], outputRange: [1, 0.55, 0.9, 1] }) },
        ] }]}>
        <Bottle size={112} />
      </Animated.View>
    </View>
    {feed.profile?.canPost ? <View style={[styles.composer, { backgroundColor: theme.surfaceAlt }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>投递你的想法</Text>
      {feed.profile.username ? <View style={styles.authorRow}><Text style={[styles.hint, { color: theme.textMuted }]}>公开署名</Text><Text style={[styles.author, { color: theme.text }]}>{feed.profile.username}</Text>{action('修改用户名', () => router.push('/username'), sending)}</View> : <>
        <Text style={[styles.label, { color: theme.textSecondary }]}>用户名</Text>
        <TextInput accessibilityLabel="用户名" value={username} editable={!sending} onChangeText={value => { setUsername(value); setSendError(null); }}
          maxLength={24} autoCapitalize="none" autoCorrect={false} placeholder="你的公开用户名" placeholderTextColor={theme.textMuted}
          style={[styles.usernameInput, { color: theme.text, backgroundColor: theme.bg }]} />
        <Text style={[styles.hint, { color: theme.textMuted }]}>2–24 个字符，可用文字、数字、下划线、点和连字符。之后可在「我的」中修改。</Text>
      </>}
      <TextInput accessibilityLabel="留言内容" multiline value={content} editable={!sending} onChangeText={value => { setContent(value); setSendError(null); setNotice(null); }}
        maxLength={MESSAGE_BOTTLE_CONTENT_LIMIT} placeholder="哪里还不够顺手？你希望增加什么功能？" placeholderTextColor={theme.textMuted}
        textAlignVertical="top" style={[styles.contentInput, { color: theme.text, backgroundColor: theme.bg }]} />
      <View style={styles.countRow}><Text style={[styles.hint, { color: theme.textMuted }]}>留言与用户名会公开显示。请勿发布广告、辱骂、色情或违法内容，违规留言会被删除，作者会被禁言。</Text><Text style={[styles.hint, { color: theme.textMuted }]}>{content.length}/{MESSAGE_BOTTLE_CONTENT_LIMIT}</Text></View>
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
    </View> : <View style={styles.loading}><BlackHoleLoader size={110} label="正在读取留言" /></View>}
    <View style={styles.listHeading}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>所有留言</Text>
      {action('刷新留言', () => void feed.refresh(), feed.refreshing || sending)}
    </View>
    {feed.error ? <View style={styles.state}><Text style={[styles.hint, { color: theme.danger }]}>{feed.error}</Text>{action('重试读取留言', () => void feed.refresh(), feed.refreshing)}</View> : null}
  </>;

  const finish = (run: () => Promise<void>, done: string) => {
    setActing(true);
    void run().then(() => { setMenu(null); notify(done); })
      .catch(cause => notify('操作没有完成', messageBottleError(cause, '请稍后重试')))
      .finally(() => setActing(false));
  };
  const report = (item: MessageBottleThreadDto, reason: MessageBottleReportReason) =>
    finish(() => feed.report(item, reason), '已收到举报，我们会尽快处理。这条留言已对你隐藏。');
  const block = (item: MessageBottleThreadDto) => confirmAction({
    title: `屏蔽「${item.username}」？`, message: '屏蔽后你将看不到对方的任何留言，可以在「设置 → 已屏蔽的用户」里解除。',
    confirmLabel: '屏蔽', destructive: true,
  }, () => finish(() => feed.block(item), '已屏蔽，对方的留言不会再出现在你的列表里。'));

  const renderMessage = ({ item }: { item: MessageBottleThreadDto }) => <View style={[styles.message, { backgroundColor: theme.surfaceAlt }]}>
    <View style={styles.messageMeta}><View style={styles.messageAuthor}><Text style={[styles.author, { color: theme.text }]}>{item.username}</Text>
      {item.isMine ? <Text style={[styles.mine, { color: theme.accent, backgroundColor: theme.accentSoft }]}>我</Text> : null}
      {item.isMine && item.status !== 'visible' ? <Text style={[styles.mine, { color: theme.textSecondary, backgroundColor: theme.bg }]}>
        {item.status === 'pending' ? '审核中 · 仅自己可见' : '未通过审核 · 仅自己可见'}</Text> : null}</View>
      <View style={styles.messageAuthor}>
        <Text style={[styles.time, { color: theme.textMuted }]}>{new Date(item.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</Text>
        {!item.isMine ? <Pressable accessibilityRole="button" accessibilityLabel={`举报或屏蔽 ${item.username} 的留言`} hitSlop={10}
          onPress={() => setMenu({ item, step: 'menu' })}><Ionicons name="ellipsis-horizontal" size={18} color={theme.textMuted} /></Pressable> : null}
      </View>
    </View>
    <Text selectable style={[styles.messageContent, { color: theme.textSecondary }]}>{item.content}</Text>
    {item.reply ? <DeveloperReply reply={item.reply} /> : null}
  </View>;

  if (developerMode && feed.canModerate) return <KeyboardAvoidingView style={[styles.screen, { backgroundColor: theme.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <BrandHeader />
    <MessageBottleModeration onRevoke={feed.revokeModeration} onExit={() => { setDeveloperMode(false); void feed.refresh(); }} />
  </KeyboardAvoidingView>;

  return <KeyboardAvoidingView style={[styles.screen, { backgroundColor: theme.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <BrandHeader />
    <FlatList data={feed.items} renderItem={renderMessage} keyExtractor={item => item.id} ListHeaderComponent={header}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(28, insets.bottom + 16) }]} showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => void feed.refresh()} tintColor={theme.accent} colors={[theme.accent]} />}
      ListEmptyComponent={feed.refreshing ? <View style={styles.loading}><BlackHoleLoader size={110} label="正在读取留言" /></View> : !feed.error ? <View style={styles.emptyBox}><EnterOnce><Bottle size={180} /></EnterOnce><Text style={[styles.empty, { color: theme.textSecondary }]}>还没有留言，来投递第一只留言瓶吧。</Text></View> : null}
      ListFooterComponent={<View style={styles.footer}>
        {feed.moreError ? <Text style={[styles.hint, { color: theme.danger }]}>{feed.moreError}</Text> : null}
        {feed.loadingMore ? <ActivityIndicator color={theme.accent} /> : feed.nextCursor ? action(feed.moreError ? '重试加载' : '加载更多留言', () => void feed.loadMore(), feed.refreshing)
          : feed.items.length > 0 && !feed.error ? <Text style={[styles.hint, { color: theme.textMuted }]}>已经看到所有留言</Text> : null}
      </View>} />
    <Modal visible={menu !== null} transparent animationType="slide" onRequestClose={() => setMenu(null)}>
      <Pressable accessibilityLabel="关闭" onPress={() => { if (!acting) setMenu(null); }} style={styles.backdrop}>
        <Pressable onPress={event => event.stopPropagation()} style={{ width: '100%' }}>
          <SheetFrame title={menu?.step === 'report' ? '举报原因' : '这条留言'}>
            {menu?.step === 'report' ? <ListGroup>{REPORT_REASONS.map(option => <ListRow key={option.reason} label={option.label}
              chevron={false} onPress={acting ? undefined : () => report(menu.item, option.reason)} />)}</ListGroup> : menu ? <ListGroup>
              <ListRow label="举报这条留言" hint="举报后它会对你隐藏，并交给人工审核" onPress={acting ? undefined : () => setMenu({ ...menu, step: 'report' })} />
              <ListRow label={`屏蔽「${menu.item.username}」`} hint="不再看到对方的任何留言" tone="danger" chevron={false}
                onPress={acting ? undefined : () => block(menu.item)} />
            </ListGroup> : null}
            {acting ? <ActivityIndicator style={{ marginTop: 14 }} color={theme.accent} /> : null}
          </SheetFrame>
        </Pressable>
      </Pressable>
    </Modal>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { ...pageContent, paddingTop: 12 }, headingRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  headingCopy: { flex: 1 }, bottleArt: { width: 112, height: 84, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  composer: { borderRadius: radius.card, padding: 18 }, sectionTitle: { fontSize: 19, fontWeight: weight('semibold'), lineHeight: 26 },
  label: { fontSize: 13, marginTop: 16 }, usernameInput: { borderRadius: 14, minHeight: 46, paddingHorizontal: 14, fontSize: 15, marginTop: 8, marginBottom: 8 },
  hint: { fontSize: 12, lineHeight: 19 }, authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  author: { fontSize: 14, fontWeight: weight('semibold'), flexShrink: 1 }, contentInput: { borderRadius: 14, minHeight: 128, padding: 14, fontSize: 15, lineHeight: 24, marginTop: 16 },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 9 },
  submit: { alignSelf: 'flex-start', borderRadius: radius.pill, minHeight: 46, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }, submitText: { fontSize: 14, fontWeight: weight('semibold') },
  feedback: { fontSize: 13, lineHeight: 20, marginTop: 10 }, loginCard: { padding: 18, gap: 12, borderRadius: radius.content }, loginHint: { fontSize: 13, lineHeight: 21 },
  smallButton: { minHeight: 38, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 16, borderRadius: radius.pill },
  listHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 30, marginBottom: 10 },
  message: { padding: 16, borderRadius: 16, marginBottom: 8 }, messageMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  messageAuthor: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 8 }, mine: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.tag, overflow: 'hidden', fontSize: 11, fontWeight: weight('semibold') }, time: { fontSize: 12, fontVariant: ['tabular-nums'] },
  messageContent: { fontSize: 15, lineHeight: 24, marginTop: 8 }, loading: { marginVertical: 22, alignItems: 'center' }, emptyBox: { alignItems: 'center', paddingVertical: 20, gap: 6 }, empty: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  state: { gap: 12, paddingVertical: 20 }, footer: { paddingVertical: 24, alignItems: 'center', gap: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(21, 14, 16, 0.42)', justifyContent: 'flex-end' },
});
