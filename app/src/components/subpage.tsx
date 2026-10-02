import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressFeedback } from '@/components/motion';
import { fonts, orbitTilt, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

/** 子页面顶栏：返回、居中标题、右侧可选文字操作；没有底线，靠留白与正文分开。 */
export function SubpageHeader({ title, right, onBack = goBack, backLabel = '返回' }: {
  title?: string; right?: React.ReactNode; onBack?: () => void; backLabel?: string;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return <View style={[styles.header, { paddingTop: insets.top + 4, backgroundColor: theme.bg }]}>
    <PressFeedback accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.touch} hitSlop={6}>
      <Ionicons name="chevron-back" size={24} color={theme.text} />
    </PressFeedback>
    <Text numberOfLines={1} accessibilityRole="header" style={[styles.headerTitle, { color: theme.text }]}>{title ?? ''}</Text>
    <View style={styles.headerSide}>{right}</View>
  </View>;
}

/** 小节标题：粗体中文 + 右侧文字操作，下方一条墨色细线。 */
export function SectionHeading({ title, action, style }: { title: string; action?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useAppTheme();
  return <View style={[styles.section, { borderBottomColor: theme.text }, style]}>
    <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
    {action}
  </View>;
}

/** 元信息行：品牌圆体小字，用于来源、时长、计数。 */
export function Meta({ children, style, tone = 'muted' }: { children: React.ReactNode; style?: StyleProp<TextStyle>; tone?: 'muted' | 'ink' | 'accent' }) {
  const { theme } = useAppTheme();
  const color = tone === 'ink' ? theme.text : tone === 'accent' ? theme.accent : theme.textMuted;
  return <Text style={[styles.meta, { color }, style]}>{children}</Text>;
}

/** 细线列表行：主文字、说明、右侧值或箭头。 */
export function ListRow({ label, hint, value, onPress, accessibilityLabel, tone = 'ink', chevron = true }: {
  label: string; hint?: string; value?: string; onPress?: () => void; accessibilityLabel?: string; tone?: 'ink' | 'danger'; chevron?: boolean;
}) {
  const { theme } = useAppTheme();
  const content = <>
    <View style={styles.rowCopy}>
      <Text style={[styles.rowLabel, { color: tone === 'danger' ? theme.danger : theme.text }]}>{label}</Text>
      {hint ? <Text style={[styles.rowHint, { color: theme.textMuted }]}>{hint}</Text> : null}
    </View>
    {value ? <Text style={[styles.rowValue, { color: theme.textMuted }]}>{value}</Text> : null}
    {onPress && chevron ? <Ionicons name="chevron-forward" size={16} color={theme.textMuted} /> : null}
  </>;
  if (!onPress) return <View style={[styles.row, { borderBottomColor: theme.border }]}>{content}</View>;
  return <PressFeedback accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={[styles.row, { borderBottomColor: theme.border }]}>{content}</PressFeedback>;
}

type ActionProps = { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle>; arrow?: boolean };

/** 主操作：朱橙胶囊。 */
export function PrimaryAction({ label, onPress, disabled = false, busy = false, accessibilityLabel, style, arrow = false }: ActionProps) {
  const { theme } = useAppTheme();
  const off = disabled || busy;
  return <PressFeedback accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
    style={[styles.primary, { backgroundColor: off ? theme.surfaceAlt : theme.accent }, style]}>
    {busy ? <ActivityIndicator size="small" color={theme.textMuted} /> : null}
    <Text style={[styles.primaryText, { color: off ? theme.textMuted : theme.accentText }]}>{label}</Text>
    {arrow && !off ? <Ionicons name="arrow-forward" size={18} color={theme.accentText} /> : null}
  </PressFeedback>;
}

/** 次要操作：朱橙描边胶囊。 */
export function SecondaryAction({ label, onPress, disabled = false, accessibilityLabel, style }: ActionProps) {
  const { theme } = useAppTheme();
  return <PressFeedback accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.secondary, { borderColor: disabled ? theme.border : theme.accent, opacity: disabled ? 0.5 : 1 }, style]}>
    <Text style={[styles.secondaryText, { color: theme.accent }]}>{label}</Text>
  </PressFeedback>;
}

/** 文字操作：只有字，用于次要入口与行内链接。 */
export function TextAction({ label, onPress, disabled = false, accessibilityLabel, tone = 'accent', style }: {
  label: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string; tone?: 'accent' | 'muted' | 'danger'; style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const color = tone === 'muted' ? theme.textSecondary : tone === 'danger' ? theme.danger : theme.accent;
  return <PressFeedback accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={6} style={[styles.textAction, { opacity: disabled ? 0.45 : 1 }, style]}>
    <Text style={[styles.textActionLabel, { color }]}>{label}</Text>
  </PressFeedback>;
}

/** 文字开关：选中时墨色加粗，下方一枚 20° 倾斜的朱橙椭圆，与底部导航一致。 */
export function ToggleText({ label, active = false, onPress, accessibilityLabel, disabled = false }: {
  label: string; active?: boolean; onPress: () => void; accessibilityLabel?: string; disabled?: boolean;
}) {
  const { theme } = useAppTheme();
  return <PressFeedback accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: active, disabled }} aria-pressed={active} disabled={disabled} onPress={onPress} style={[styles.toggle, { opacity: disabled ? 0.45 : 1 }]}>
    <Text style={[styles.toggleLabel, { color: active ? theme.text : theme.textSecondary, fontWeight: weight(active ? 'semibold' : 'regular') }]}>{label}</Text>
    <View style={[styles.toggleMark, { backgroundColor: active ? theme.vermilion : 'transparent' }]} />
  </PressFeedback>;
}

/** 底部弹层外壳：顶部圆角、拖拽条、标题；内容由调用方提供。 */
export function SheetFrame({ title, children, style }: { title: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: Math.max(20, insets.bottom + 8) }, style]}>
    <View style={[styles.grip, { backgroundColor: theme.border }]} />
    <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.text }]}>{title}</Text>
    {children}
  </View>;
}

export const subpageStyles = StyleSheet.create({
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 24 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: weight('bold') },
  lede: { fontSize: 15, lineHeight: 24 },
  hint: { fontSize: 12, lineHeight: 19 },
  number: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38 },
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: weight('semibold') },
  headerSide: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 8 },
  touch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  section: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderBottomWidth: 1.5, paddingBottom: 8, marginTop: 32, marginBottom: 4, gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: weight('bold') },
  meta: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowLabel: { fontSize: 16, fontWeight: weight('medium') },
  rowHint: { fontSize: 12, lineHeight: 18 },
  rowValue: { fontSize: 13 },
  primary: { minHeight: 50, borderRadius: radius.pill, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 16, fontWeight: weight('semibold') },
  secondary: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1.5, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 14, fontWeight: weight('semibold') },
  textAction: { minHeight: 44, justifyContent: 'center' },
  textActionLabel: { fontSize: 14, fontWeight: weight('semibold') },
  toggle: { minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 5 },
  toggleLabel: { fontSize: 13 },
  toggleMark: { width: 12, height: 4, borderRadius: '50%', transform: [{ rotate: orbitTilt }] },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 24, paddingTop: 10, maxHeight: '88%' },
  grip: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: weight('bold'), marginBottom: 12 },
});
