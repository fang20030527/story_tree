import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useLayoutWidth } from '@/components/useLayoutWidth';
import React, { useCallback, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VocabularyWordPage } from '@context-reader/contracts';
import { getAccountProfile } from '@/api/account';
import { getVocabularyWords } from '@/api/practices';
import { StatRow, TouchCard } from '@/components/brand';
import { notify } from '@/components/confirm';
import { Moon, OrbitProgress, PlanetHorizon, RingedPlanet } from '@/components/cosmos';
import { PressFeedback } from '@/components/motion';
import { ListGroup, SectionHeading } from '@/components/subpage';
import { fonts, radius, typeScale, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { useModeAccent } from '@/context/modeAccent';
import * as authStorage from '@/features/auth/authStorage';
import { loadRecentViews } from '@/features/library/libraryStorage';
import { ModeCards } from '@/features/mode/ModeSwitch';
import { PracticePreferencesCard } from '@/features/practice/PracticePreferencesCard';
import { StudyLog } from '@/features/study/StudyLog';
import { DAILY_GOAL_MS, loadStudyTotals, localDateKey, type StudyTotals } from '@/features/study/studyStorage';
import { useLearningMode } from '@/context/LearningModeContext';
import { useSpeakingLibrary } from '@/features/speaking/useSpeakingLibrary';

const MENU = [
  { icon: 'time-outline' as const, label: '最近阅读', sub: '继续上次的阅读', route: '/recent' as const },
  { icon: 'bookmark-outline' as const, label: '我的收藏', sub: '喜欢的文章，都在书架', route: '/shelf' as const },
  { icon: 'book-outline' as const, label: '阅读练习', sub: '把熟悉的词，读出新意思', route: '/practice/from-vocabulary' as const },
  { icon: 'document-text-outline' as const, label: '导入文章', sub: '添加自己的阅读材料', route: '/import' as const },
  { icon: 'help-circle-outline' as const, label: '功能指南', sub: '', route: '/feature-guide' as const },
];
const SPEAKING_MENU = [
  { icon: 'time-outline' as const, label: '最近跟读', sub: '继续自己的表达节奏', route: '/speaking/history' as const },
  { icon: 'folder-outline' as const, label: '我的文件', sub: '我的音视频与字幕', route: '/shelf' as const },
  { icon: 'mic-outline' as const, label: '跟读素材', sub: '找到适合自己的声音', route: '/' as const },
  { icon: 'cloud-upload-outline' as const, label: '导入文件', sub: '音频、视频与字幕', route: '/speaking/import' as const },
  { icon: 'help-circle-outline' as const, label: '跟读指南', sub: '', route: '/speaking/guide' as const },
];

/** 截至今天（今天还没学就从昨天算起）连续有学习记录的天数。 */
function studyStreak(totals: StudyTotals, now: Date) {
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!(totals[localDateKey(cursor)] ?? 0)) cursor.setDate(cursor.getDate() - 1);
  while ((totals[localDateKey(cursor)] ?? 0) > 0 && streak < 400) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

export default function ProfileScreen() {
  const { theme } = useAppTheme();
  const accent = useModeAccent();
  const { mode } = useLearningMode();
  const speaking = mode === 'speak';
  const oral = useSpeakingLibrary();
  const insets = useSafeAreaInsets();
  const width = useLayoutWidth();
  const wide = width >= 1100;
  const [isRegistered, setIsRegistered] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState<number | null>(null);
  const [summary, setSummary] = useState<VocabularyWordPage['summary'] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [studyTotals, setStudyTotals] = useState<StudyTotals>({});
  const [studyError, setStudyError] = useState(false);
  useFocusEffect(useCallback(() => {
    let mounted = true;
    const refresh = () => {
      setNow(new Date());
      void loadStudyTotals().then(totals => { if (mounted) { setStudyTotals(totals); setStudyError(false); } }).catch(() => { if (mounted) setStudyError(true); });
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const emailPromise = typeof authStorage.loadAuthUserEmail === 'function' ? authStorage.loadAuthUserEmail().catch(() => null) : Promise.resolve(null);
    void Promise.all([authStorage.loadAuthUser(), emailPromise]).then(([user, email]) => {
      if (!mounted) return;
      setIsRegistered(Boolean(user)); setAuthEmail(user ? email : null);
      if (!user) { setUsername(null); return; }
      // 用户名只是展示信息：读取失败时保留原来的称呼，不影响已登录状态。
      void (async () => {
        try { const account = await getAccountProfile(); if (mounted) setUsername(account.username); }
        catch { if (mounted) setUsername(null); }
      })();
    }).catch(() => { if (mounted) { setIsRegistered(false); setAuthEmail(null); setUsername(null); } });
    if (!speaking) {
      void loadRecentViews().then(entries => { if (mounted) setRecentCount(entries.length); }).catch(() => { if (mounted) setRecentCount(null); });
      void getVocabularyWords({ limit: 1 }).then(page => { if (mounted) setSummary(page.summary); }).catch(() => { if (mounted) setSummary(null); });
    }
    return () => { mounted = false; clearInterval(timer); subscription.remove(); };
  }, [speaking]));
  const oralTotals = oral.store.history.reduce<StudyTotals>((totals, session) => { const day = localDateKey(new Date(session.date)); totals[day] = (totals[day] ?? 0) + session.elapsedMs; return totals; }, {});
  const activeTotals = speaking ? oralTotals : studyTotals;
  const activeError = speaking ? Boolean(oral.error) : studyError;
  const todayMs = activeTotals[localDateKey(now)] ?? 0;
  const todayDuration = todayMs > 0 && todayMs < 60_000 ? Math.floor(todayMs / 1_000) + '秒' : Math.floor(todayMs / 60_000) + 'min';
  const streak = activeError ? 0 : studyStreak(activeTotals, now);
  const logout = async () => {
    try { await authStorage.clearAuthUser(); setIsRegistered(false); setAuthEmail(null); setUsername(null); setStudyTotals({}); setSummary(null); router.push('/login'); }
    catch { notify('退出登录失败', '请稍后重试'); }
  };
  const stats = speaking
    ? [{ label: '已练素材', value: activeError ? '—' : new Set(oral.store.history.map(item => item.materialId)).size },
      { label: '练习次数', value: activeError ? '—' : oral.store.history.length },
      { label: '累计分钟', value: activeError ? '—' : Math.floor(oral.store.history.reduce((sum, item) => sum + item.elapsedMs, 0) / 60000) }]
    : [{ label: '近期阅读', value: recentCount ?? '—' },
      { label: '词库单词', value: summary?.totalCount ?? '—' },
      { label: '已掌握', value: summary?.masteredCount ?? '—', glyph: <Moon phase={1} size={12} lit={accent.ink} /> }];
  return <View style={[styles.screen, { backgroundColor: theme.bg }]}>
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.pageTitle, { color: theme.text }]}>我的</Text>
        <PressFeedback accessibilityRole="button" accessibilityLabel="设置" onPress={() => router.push('/settings')} style={styles.iconButton} hitSlop={4}>
          <Ionicons name="settings-outline" size={22} color={theme.text} />
        </PressFeedback>
      </View>
      <View style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: theme.surfaceAlt }]}><RingedPlanet size={46} seam={theme.surfaceAlt} /></View>
        <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.username, { color: theme.text }]}>{isRegistered ? username ?? (speaking ? '学习者' : '阅读者') : '未登录'}</Text><Text numberOfLines={1} style={[styles.identityHint, { color: theme.textMuted }]}>{speaking ? isRegistered ? '口语文件与练习同步到账号' : '登录后同步口语文件与练习' : isRegistered ? authEmail ?? '继续积累你的阅读' : '登录后同步阅读记录与词库'}</Text></View>
        {!isRegistered ? <PressFeedback accessibilityRole="button" accessibilityLabel="去登录" onPress={() => router.push('/login')} style={[styles.login, { backgroundColor: theme.accentSoft }]}><Text style={[styles.loginText, { color: theme.accent }]}>登录</Text></PressFeedback> : null}
        {isRegistered && username ? <PressFeedback accessibilityRole="button" accessibilityLabel="修改用户名" onPress={() => router.push('/username')} style={[styles.login, { backgroundColor: theme.accentSoft }]}><Text style={[styles.loginText, { color: theme.accent }]}>修改</Text></PressFeedback> : null}
      </View>
      <View style={wide ? styles.columns : undefined}>
        <View style={wide ? styles.column : undefined}>
          <ModeCards />
          <TouchCard onPress={() => router.push('/pro')} accessibilityLabel="升级为 VIP 版" style={[styles.vip, { backgroundColor: theme.space }]}>
            <PlanetHorizon width={340} height={128} seed={4} />
            <View style={styles.vipCopy}>
              <Text style={[styles.vipTitle, { color: theme.onSpace }]}>VIP</Text>
              <Text style={[styles.vipHint, { color: theme.onSpaceMuted }]}>阅读与口语一起进步</Text>
            </View>
            <View style={[styles.vipButton, { backgroundColor: theme.onSpace }]}>
              <Text style={[styles.vipButtonText, { color: theme.space }]}>查看方案</Text>
              <Ionicons name="chevron-forward" size={14} color={theme.space} />
            </View>
          </TouchCard>
          <View accessible accessibilityLabel={activeError ? '学习时长读取失败' : `今日已学 ${todayDuration}，每日目标 10 分钟${streak > 1 ? `，已连续 ${streak} 天` : ''}`} style={[styles.today, { backgroundColor: theme.surfaceAlt }]}>
            <OrbitProgress value={activeError ? 0 : todayMs / DAILY_GOAL_MS} size={120} color={accent.ink} seam={theme.surfaceAlt} />
            <View style={styles.todayCopy}>
              <Text style={[styles.todayNumber, { color: theme.text }]}>{activeError ? '…' : Math.floor(todayMs / 60_000)}<Text style={[styles.todayUnit, { color: theme.textMuted }]}> / 10 分钟</Text></Text>
              <Text style={[styles.todayLabel, { color: theme.textSecondary }]}>{activeError ? '学习时长读取失败' : '今日已学 ' + todayDuration}</Text>
              {streak > 1 ? <View style={[styles.streak, { backgroundColor: theme.bg }]}><Ionicons name="sparkles" size={11} color={accent.ink} /><Text style={[styles.streakText, { color: accent.ink }]}>已连续 {streak} 天</Text></View> : null}
            </View>
          </View>
          <SectionHeading title="学习记录" />
          <StatRow items={stats} style={styles.statRow} />
          <StudyLog totals={activeTotals} now={now} error={activeError} />
          <Text style={[styles.localNote, { color: theme.textMuted }]}>{speaking ? isRegistered ? '跟读记录同步到账号，原有设备记录继续保留。' : '跟读记录保存在当前设备，登录后可使用账号同步。' : '学习日志保存在当前设备，记录实际阅读和练习时长。'}</Text>
        </View>
        <View style={wide ? styles.column : undefined}>
          <SectionHeading title="我的内容" />
          <ListGroup>
            {(speaking ? SPEAKING_MENU : MENU).map(item => <PressFeedback key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => router.push(item.route)} style={styles.menu}>
              <View style={[styles.menuIcon, { backgroundColor: theme.bg }]}><Ionicons name={item.icon} size={18} color={theme.textSecondary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.menuTitle, { color: theme.text }]}>{item.label}</Text>{item.sub ? <Text style={[styles.menuHint, { color: theme.textMuted }]}>{item.sub}</Text> : null}</View>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </PressFeedback>)}
          </ListGroup>
          {!speaking ? <PracticePreferencesCard /> : null}
          {isRegistered ? <PressFeedback accessibilityRole="button" accessibilityLabel="退出登录" onPress={() => void logout()} style={styles.logout}><Text style={{ color: theme.danger, fontSize: 15 }}>退出登录</Text></PressFeedback> : null}
        </View>
      </View>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, width: '100%', maxWidth: 1040, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  pageTitle: { ...typeScale.pageTitle, letterSpacing: 0.4 },
  iconButton: { minHeight: 40, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 },
  avatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  username: { fontSize: 17, fontWeight: weight('semibold') },
  identityHint: { fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  login: { minHeight: 34, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  loginText: { fontSize: 13.5, fontWeight: weight('semibold') },
  vip: { height: 128, borderRadius: radius.card, overflow: 'hidden', padding: 18, marginTop: 14, justifyContent: 'space-between' },
  vipCopy: { gap: 2 },
  vipTitle: { fontFamily: fonts.display, fontSize: 27, lineHeight: 32, letterSpacing: 1 },
  vipHint: { fontSize: 13, lineHeight: 18 },
  vipButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32, paddingLeft: 14, paddingRight: 10, borderRadius: radius.pill },
  vipButtonText: { fontSize: 13, fontWeight: weight('semibold') },
  today: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.card, paddingVertical: 12, paddingLeft: 8, paddingRight: 16, marginTop: 14 },
  todayCopy: { flex: 1, minWidth: 0, gap: 2 },
  todayNumber: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, fontVariant: ['tabular-nums'] },
  todayUnit: { fontSize: 13, fontWeight: weight('medium') },
  todayLabel: { fontSize: 12.5, lineHeight: 18 },
  streak: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 4, marginTop: 6, paddingVertical: 2, paddingLeft: 7, paddingRight: 9, borderRadius: radius.pill },
  streakText: { fontSize: 12, fontWeight: weight('semibold') },
  statRow: { marginTop: 0, marginBottom: 4 },
  columns: { flexDirection: 'row', gap: 40 },
  column: { flex: 1, minWidth: 0 },
  localNote: { fontSize: 11.5, lineHeight: 18, marginTop: 4 },
  menu: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  menuIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontSize: 15.5, fontWeight: weight('medium') },
  menuHint: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  logout: { minHeight: 52, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
});
