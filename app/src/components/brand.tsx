import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlackHoleLoader } from '@/components/cosmos';
import { PressFeedback } from '@/components/motion';
import { fonts, typeScale, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { ModeCapsule } from '@/features/mode/ModeSwitch';

export function BrandLogo({ width = 38 }: { width?: number }) {
  return <Image source={require('../../assets/images/black-hole-english-logo.svg')} accessibilityLabel="黑洞英语 Logo"
    contentFit="contain" style={{ width, height: width / 1.805 }} />;
}

/** 主页面顶栏：logo 与名称；首页在右侧放模式胶囊；可选一个图标或文字操作。 */
export function BrandHeader({ action, label, onPress, modeSwitch = false }: {
  action?: keyof typeof Ionicons.glyphMap; label?: string; onPress?: () => void; modeSwitch?: boolean;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
    <View style={styles.brand}><BrandLogo width={34} /><Text style={[styles.brandName, { color: theme.text }]}>黑洞英语</Text></View>
    <View style={styles.headerSide}>
      {modeSwitch ? <ModeCapsule /> : null}
      {onPress ? <PressFeedback onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.headerAction} hitSlop={4}>
        {action ? <Ionicons name={action} color={theme.text} size={22} /> : <Text style={{ color: theme.text, fontSize: 15, fontWeight: weight('medium') }}>{label}</Text>}
      </PressFeedback> : null}
    </View>
  </View>;
}

/** 页面标题：中粗 27pt，说明在下方一行。 */
export function PageHeading({ title, description }: { title: string; description?: string }) {
  const { theme } = useAppTheme();
  return <View style={styles.heading}>
    <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
    {description ? <Text style={[styles.description, { color: theme.textSecondary }]}>{description}</Text> : null}
  </View>;
}

type StatItem = { label: string; value: string | number; testID?: string; glyph?: React.ReactNode };

/** 统计：数字用 Literata 等宽数字；还没读到时显示省略号，不再用灰色短横。 */
export function StatRow({ items, style }: { items: StatItem[]; style?: StyleProp<ViewStyle> }) {
  const { theme } = useAppTheme();
  return <View style={[styles.stats, style]}>{items.map(item => {
    const pending = item.value === '—';
    return <View key={item.label} style={[styles.stat, { backgroundColor: theme.surfaceAlt }]}>
      <Text testID={item.testID} style={[styles.statValue, { color: pending ? theme.textMuted : theme.text }]}>{pending ? '…' : item.value}</Text>
      <View style={styles.statLabelRow}>{item.glyph}<Text style={[styles.statLabel, { color: theme.textMuted }]}>{item.label}</Text></View>
    </View>;
  })}</View>;
}

/** 可点的内容卡片：按压时缩到 0.97、透明度 0.86；600ms 内连点只触发一次，避免重复打开同一页。 */
export function TouchCard({ children, onPress, style, accessibilityLabel }: { children: React.ReactNode; onPress: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel: string }) {
  const lastPress = useRef(0);
  const press = () => {
    const now = Date.now();
    if (now - lastPress.current < 600) return;
    lastPress.current = now;
    onPress();
  };
  return <PressFeedback onPress={press} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={style}>{children}</PressFeedback>;
}

/** 生成与加载：黑洞吸积盘流动、粒子绕盘运行；减少动态效果时静止。 */
export function OrbitLoader({ size = 150, label = '正在生成' }: { size?: number; label?: string }) {
  return <BlackHoleLoader size={size} label={label} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 6, minHeight: 58 },
  brand: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  brandName: { fontSize: 16, fontWeight: weight('semibold'), letterSpacing: 0.3 },
  headerSide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerAction: { minHeight: 40, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  heading: { marginBottom: 18, gap: 2 },
  title: { ...typeScale.pageTitle, letterSpacing: 0.4 },
  description: { fontSize: 14, lineHeight: 21 },
  stats: { flexDirection: 'row', gap: 8, marginVertical: 18 },
  stat: { flex: 1, minWidth: 0, borderRadius: 16, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 10, gap: 2 },
  statValue: { fontFamily: fonts.display, fontSize: 27, lineHeight: 33, fontVariant: ['tabular-nums'] },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statLabel: { fontSize: 12 },
});
