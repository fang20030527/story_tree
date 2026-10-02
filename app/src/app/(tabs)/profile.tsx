import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useLayoutWidth } from '@/components/useLayoutWidth';
import React, { useCallback, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VocabularyWordPage } from '@context-reader/contracts';
import { getVocabularyWords } from '@/api/practices';
import { LogoPlanes, StatRow, TouchCard } from '@/components/brand';
import { fonts, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import * as authStorage from '@/features/auth/authStorage';
import { loadRecentViews } from '@/features/library/libraryStorage';
import { PracticePreferencesCard } from '@/features/practice/PracticePreferencesCard';
import { StudyLog } from '@/features/study/StudyLog';
import { loadStudyTotals, localDateKey, type StudyTotals } from '@/features/study/studyStorage';
import { useLearningMode } from '@/context/LearningModeContext';
import { LearningModeMenu } from '@/features/speaking/LearningModeMenu';
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

export default function ProfileScreen() {
  const { theme } = useAppTheme();
  const { mode } = useLearningMode();
  const speaking = mode === 'speak';
  const oral = useSpeakingLibrary();
  const insets = useSafeAreaInsets();
  const width = useLayoutWidth();
  const wide = width >= 1100;
  const [isRegistered, setIsRegistered] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
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
    void Promise.all([authStorage.loadAuthUser(), emailPromise]).then(([user, email]) => { if (mounted) { setIsRegistered(Boolean(user)); setAuthEmail(user ? email : null); } }).catch(() => { if (mounted) { setIsRegistered(false); setAuthEmail(null); } });
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
  const logout = async () => {
    try { await authStorage.clearAuthUser(); setIsRegistered(false); setAuthEmail(null); setStudyTotals({}); setSummary(null); router.push('/login'); }
    catch { Alert.alert('退出登录失败', '请稍后重试'); }
  };
  return <View style={[styles.screen, { backgroundColor: theme.bg }]}>
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><LearningModeMenu /><TouchableOpacity accessibilityRole="button" accessibilityLabel="设置" onPress={() => router.push('/settings')} style={styles.settings}><Ionicons name="settings-outline" size={23} color={theme.text} /><Text style={{ color: theme.text }}>设置</Text></TouchableOpacity></View>
      <View style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: theme.surfaceAlt }]}><Ionicons name="person-outline" size={26} color={theme.textSecondary} /></View>
        <View style={{ flex: 1 }}><Text style={[styles.username, { color: theme.text }]}>{isRegistered ? speaking ? '学习者' : '阅读者' : '未登录'}</Text><Text numberOfLines={1} style={[styles.identityHint, { color: theme.textMuted }]}>{speaking ? isRegistered ? '口语文件与练习同步到账号' : '登录后同步口语文件与练习' : isRegistered ? authEmail ?? '继续积累你的阅读' : '登录后同步阅读记录与词库'}</Text></View>
        {!isRegistered ? <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/login')} style={styles.settings}><Text style={{ color: theme.accent }}>去登录</Text><Ionicons name="chevron-forward" size={16} color={theme.accent} /></TouchableOpacity> : null}
      </View>
      <TouchCard onPress={() => router.push('/pro')} accessibilityLabel="升级为 VIP 版" style={[styles.vip, { backgroundColor: theme.surfaceAlt }]}><LogoPlanes /><View style={styles.vipCopy}><Text style={[styles.vipTitle, { color: theme.onPink }]}>VIP</Text><Text style={[styles.vipHint, { color: theme.onPink }]}>阅读与口语一起进步</Text></View><View style={[styles.vipButton, { backgroundColor: theme.text }]}><Text style={{ color: theme.bg, fontSize: 12, fontWeight: weight('semibold') }}>查看方案</Text></View></TouchCard>
      <View style={wide ? styles.columns : undefined}>
        <View style={wide ? styles.column : undefined}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>学习记录</Text>
          <StatRow items={speaking ? [{ label: '已练素材', value: activeError ? '—' : new Set(oral.store.history.map(item => item.materialId)).size }, { label: '练习次数', value: activeError ? '—' : oral.store.history.length }, { label: '累计分钟', value: activeError ? '—' : Math.floor(oral.store.history.reduce((sum, item) => sum + item.elapsedMs, 0) / 60000) }] : [{ label: '近期阅读', value: recentCount ?? '—' }, { label: '词库单词', value: summary?.totalCount ?? '—' }, { label: '已掌握', value: summary?.masteredCount ?? '—' }]} />
          <Text style={[styles.duration, { color: theme.textSecondary }]}>{activeError ? '学习时长读取失败' : '今日已学 ' + todayDuration}</Text>
          <StudyLog totals={activeTotals} now={now} error={activeError} />
          <Text style={[styles.localNote, { color: theme.textMuted }]}>{speaking ? isRegistered ? '跟读记录同步到账号，原有设备记录继续保留。' : '跟读记录保存在当前设备，登录后可使用账号同步。' : '学习日志保存在当前设备，记录实际阅读和练习时长。'}</Text>
        </View>
        <View style={wide ? styles.column : undefined}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>我的内容</Text>
          {(speaking ? SPEAKING_MENU : MENU).map(item => <TouchableOpacity key={item.label} accessibilityRole="button" onPress={() => router.push(item.route)} style={[styles.menu, { borderBottomColor: theme.border }]}><Ionicons name={item.icon} size={22} color={theme.textSecondary} /><View style={{ flex: 1 }}><Text style={[styles.menuTitle, { color: theme.text }]}>{item.label}</Text>{item.sub ? <Text style={[styles.menuHint, { color: theme.textMuted }]}>{item.sub}</Text> : null}</View><Ionicons name="chevron-forward" size={17} color={theme.textMuted} /></TouchableOpacity>)}
          {!speaking ? <PracticePreferencesCard /> : null}
          {isRegistered ? <TouchableOpacity onPress={() => void logout()} style={styles.logout}><Text style={{ color: theme.danger }}>退出登录</Text></TouchableOpacity> : null}
        </View>
      </View>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 24, width: '100%', maxWidth: 1040, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  pageTitle: { fontSize: 28 },
  settings: { flexDirection: 'row', gap: 7, minHeight: 44, alignItems: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 26 },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  username: { fontSize: 18, fontWeight: weight('semibold') },
  identityHint: { fontSize: 11, lineHeight: 18, marginTop: 5 },
  vip: { height: 104, borderRadius: radius.content, overflow: 'hidden', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', padding: 14 },
  vipCopy: { gap: 2 },
  vipTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30 },
  vipHint: { fontSize: 12, lineHeight: 17 },
  vipButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill },
  columns: { flexDirection: 'row', gap: 40 },
  column: { flex: 1, minWidth: 0 },
  sectionLabel: { fontSize: 12, marginTop: 30, letterSpacing: 0.5 },
  duration: { fontSize: 12, marginBottom: 6 },
  localNote: { fontSize: 10, lineHeight: 18, marginTop: 8 },
  menu: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  menuTitle: { fontSize: 16, fontWeight: weight('medium') },
  menuHint: { fontSize: 11, lineHeight: 18, marginTop: 5 },
  logout: { minHeight: 52, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
});
