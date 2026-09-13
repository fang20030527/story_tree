import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui';
import { ThemeMode, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import * as authStorage from '@/features/auth/authStorage';
import { loadRecentViews } from '@/features/library/libraryStorage';

const MENU: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  route: '/recent' | '/feature-guide' | '/settings' | null;
}[] = [
  { icon: 'time-outline', label: '最近观看', sub: '', route: '/recent' },
  { icon: 'cube-outline', label: '功能概览', sub: '基础功能操作指引', route: '/feature-guide' },
  { icon: 'thumbs-up-outline', label: '给我评分', sub: '', route: null },
  { icon: 'settings-outline', label: '设置', sub: '', route: '/settings' },
];

async function openAppReview() {
  // 应用尚未上架，评分链接打不开时给出友好提示
  const url = 'itms-apps://itunes.apple.com/app/id0000000000?action=write-review';
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // fall through to the friendly alert
  }
  Alert.alert('感谢支持', '应用尚未上架应用商店，先收下这份鼓励吧！');
}

// 2026-09 的日历（9月1日是周二），周日开头
const CAL_DAYS: (number | null)[] = [
  30, 31, 1, 2, 3, 4, 5,
  6, 7, 8, 9, 10, 11, 12,
  13, 14, 15, 16, 17, 18, 19,
  20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, null, null, null,
];
const TODAY = 5;

const APPEARANCE_OPTIONS: { key: 'system' | ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
  { key: 'light', label: '浅色', icon: 'sunny-outline' },
  { key: 'dark', label: '深色', icon: 'moon-outline' },
];

export default function ProfileScreen() {
  const { theme, preference, setPreference } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [isRegistered, setIsRegistered] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const emailPromise = typeof authStorage.loadAuthUserEmail === 'function'
        ? Promise.resolve(authStorage.loadAuthUserEmail()).catch(() => null)
        : Promise.resolve(null);
      void Promise.all([authStorage.loadAuthUser(), emailPromise, loadRecentViews()])
        .then(([user, email, recents]) => {
          if (!mounted) return;
          setIsRegistered(Boolean(user));
          setAuthEmail(user ? email : null);
          setRecentCount(recents.length);
        })
        .catch(() => {
          if (!mounted) return;
          setIsRegistered(false);
          setAuthEmail(null);
          setRecentCount(0);
        });
      return () => {
        mounted = false;
      };
    }, []),
  );

  const handleLogout = async () => {
    try {
      await authStorage.clearAuthUser();
      setIsRegistered(false);
      setAuthEmail(null);
      router.replace('/login');
    } catch {
      Alert.alert('退出登录失败', '请稍后重试');
    }
  };

  const stats = [
    { label: '生词', value: 6 },
    { label: '学习篇数', value: recentCount },
    { label: '打卡天数', value: 0 },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}>
        {/* 用户信息区 */}
        <View style={[styles.userArea, { paddingTop: insets.top + 16, backgroundColor: theme.surfaceAlt }]}>
          <View style={styles.userRow}>
            <TouchableOpacity
              onPress={() => {
                if (!isRegistered) router.push('/login');
              }}
              activeOpacity={0.85}
              style={styles.userIdentity}>
              <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name="person" size={30} color={theme.accent} />
              </View>
              <View style={styles.identityText}>
                <Text style={[styles.username, { color: theme.text }]}>
                  {isRegistered ? '已登录用户' : '注册 / 登录'}
                </Text>
                {isRegistered && authEmail ? (
                  <Text style={[styles.email, { color: theme.textSecondary }]} numberOfLines={1}>
                    {authEmail}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={8} onPress={() => router.push('/settings')}>
              <Ionicons name="settings-outline" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => Alert.alert('敬请期待', 'Pro 版即将上线，敬请期待更多高级功能。')}>
            <Card theme={theme} style={styles.vipCard}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.vipTitle, { color: theme.accent }]}>
                  升级为 Pro 版
                </Text>
                <Text style={[styles.vipSub, { color: theme.textSecondary }]}>
                  解锁全部高级功能 · 畅读外刊与长文复习
                </Text>
              </View>
              <View style={[styles.vipBadge, { backgroundColor: theme.danger }]}>
                <Text style={styles.vipBadgeText}>2025 特惠</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </Card>
          </TouchableOpacity>

          <View style={styles.statsRow}>
            {stats.map((s) => (
              <View key={s.label} style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.text }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* 学习日历 */}
        <View style={{ paddingHorizontal: 16 }}>
          <Card theme={theme} style={styles.calendarCard}>
            <View style={styles.calendarHeader}>
              <Text style={[styles.calendarTitle, { color: theme.text }]}>
                学习日历 2026.09
              </Text>
              <Ionicons name="chevron-down" size={14} color={theme.textMuted} />
            </View>
            <View style={styles.weekRow}>
              {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
                <Text key={d} style={[styles.weekText, { color: theme.textMuted }]}>
                  {d}
                </Text>
              ))}
            </View>
            <View style={styles.daysGrid}>
              {CAL_DAYS.map((d, i) => {
                const isToday = d === TODAY && i < 7;
                const isCurrentMonth = i > 1 && d !== null;
                return (
                  <View key={i} style={styles.dayCell}>
                    {d !== null ? (
                      <View
                        style={[
                          styles.dayCircle,
                          isToday && { borderColor: theme.accent, borderWidth: 2 },
                        ]}>
                        <Text
                          style={{
                            color: isCurrentMonth ? theme.text : theme.textMuted,
                            fontSize: 13,
                            fontWeight: weight(isToday ? 'bold' : 'regular'),
                          }}>
                          {isToday ? '今日' : d}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <View style={[styles.todaySummary, { borderTopColor: theme.border }]}>
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                完成 10 分钟学习
              </Text>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: weight('semibold') }}>
                今日已学 0min
              </Text>
            </View>
          </Card>

          {/* 外观模式 */}
          <Card theme={theme} style={styles.appearanceCard}>
            <Text style={[styles.appearanceTitle, { color: theme.text }]}>外观模式</Text>
            <View style={[styles.segment, { backgroundColor: theme.surfaceAlt }]}>
              {APPEARANCE_OPTIONS.map((o) => {
                const active = preference === o.key;
                return (
                  <TouchableOpacity
                    key={o.key}
                    onPress={() => setPreference(o.key)}
                    style={[
                      styles.segmentItem,
                      active && {
                        backgroundColor: theme.surface,
                        borderColor: theme.accent,
                        borderWidth: 1,
                      },
                    ]}>
                    <Ionicons
                      name={o.icon}
                      size={16}
                      color={active ? theme.accent : theme.textMuted}
                    />
                    <Text
                      style={{
                        color: active ? theme.text : theme.textMuted,
                        fontSize: 12,
                        fontWeight: weight(active ? 'semibold' : 'regular'),
                      }}>
                      {o.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>

          {/* 菜单列表 */}
          <Card theme={theme} style={styles.menuCard}>
            {MENU.map((m, i) => (
              <TouchableOpacity
                key={m.label}
                activeOpacity={0.7}
                onPress={() => {
                  if (m.route) {
                    router.push(m.route);
                  } else {
                    void openAppReview();
                  }
                }}
                style={[
                  styles.menuRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                ]}>
                <Ionicons name={m.icon} size={19} color={theme.textSecondary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.menuLabel, { color: theme.text }]}>{m.label}</Text>
                  {m.sub ? (
                    <Text style={[styles.menuSub, { color: theme.textMuted }]}>{m.sub}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
              </TouchableOpacity>
            ))}
            {isRegistered ? (
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.7}
                onPress={() => void handleLogout()}
                style={[
                  styles.menuRow,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                ]}>
                <Ionicons name="log-out-outline" size={19} color={theme.danger} />
                <Text style={[styles.menuLabel, styles.logoutLabel, { color: theme.danger }]}>退出登录</Text>
                <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
              </TouchableOpacity>
            ) : null}
          </Card>

          <Text style={[styles.version, { color: theme.textMuted }]}>
            外刊精读 Version 0.1.0
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  userArea: { paddingHorizontal: 16, paddingBottom: 20 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  userIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityText: { flex: 1 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  username: { fontSize: 18, fontWeight: weight('semibold') },
  email: { fontSize: 13, marginTop: 4 },
  vipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    marginTop: 18,
  },
  vipTitle: { fontSize: 16, fontWeight: weight('bold') },
  vipSub: { fontSize: 12, marginTop: 4 },
  vipBadge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  vipBadgeText: { color: '#fff', fontSize: 10, fontWeight: weight('bold') },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: weight('bold') },
  statLabel: { fontSize: 12, marginTop: 4 },
  calendarCard: { padding: 16, marginTop: 16 },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calendarTitle: { fontSize: 16, fontWeight: weight('bold') },
  weekRow: { flexDirection: 'row', marginTop: 14 },
  weekText: { flex: 1, textAlign: 'center', fontSize: 12 },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  dayCell: { width: '14.285%', alignItems: 'center', paddingVertical: 4 },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todaySummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 12,
  },
  appearanceCard: { padding: 16, marginTop: 16 },
  appearanceTitle: { fontSize: 16, fontWeight: weight('bold') },
  segment: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    marginTop: 12,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 8,
  },
  menuCard: { marginTop: 16, paddingHorizontal: 16 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
  },
  menuLabel: { fontSize: 15 },
  logoutLabel: { flex: 1, marginLeft: 12 },
  menuSub: { fontSize: 12, marginTop: 2 },
  version: { textAlign: 'center', fontSize: 11, marginTop: 20 },
});
