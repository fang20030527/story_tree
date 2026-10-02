import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, orbitTilt, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

export function BrandLogo({ width = 38 }: { width?: number }) {
  return <Image source={require('../../assets/images/black-hole-english-logo.svg')} accessibilityLabel="黑洞英语 Logo"
    contentFit="contain" style={{ width, height: width / 1.805 }} />;
}

export function BrandHeader({ action, label, onPress }: { action?: keyof typeof Ionicons.glyphMap; label?: string; onPress?: () => void }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
    <View style={styles.brand}><BrandLogo /><Text style={[styles.brandName, { color: theme.text }]}>黑洞英语</Text></View>
    {onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.headerAction}>
      {action ? <Ionicons name={action} color={theme.text} size={24} /> : <Text style={{ color: theme.text, fontSize: 15 }}>{label}</Text>}
    </Pressable> : null}
  </View>;
}

export function PageHeading({ title, description }: { title: string; description?: string }) {
  const { theme } = useAppTheme();
  return <View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
    {description ? <Text style={[styles.description, { color: theme.textMuted }]}>{description}</Text> : null}</View>;
}

export function StatRow({ items }: { items: { label: string; value: string | number; testID?: string }[] }) {
  const { theme } = useAppTheme();
  return <View style={styles.stats}>{items.map(item => <View key={item.label} style={[styles.stat, { backgroundColor: theme.surfaceAlt }]}>
    <Text testID={item.testID} style={[styles.statValue, { color: item.value === '—' ? theme.textMuted : theme.text }]}>{item.value}</Text>
    <Text style={[styles.statLabel, { color: theme.textMuted }]}>{item.label}</Text>
  </View>)}</View>;
}

export function TouchCard({ children, onPress, style, accessibilityLabel, animateOnPress = false }: { children: React.ReactNode; onPress: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel: string; animateOnPress?: boolean }) {
  const [reduceMotion, setReduceMotion] = useState(true);
  const [tapProgress] = useState(() => new Animated.Value(1));
  const animating = useRef(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => () => tapProgress.stopAnimation(), [tapProgress]);
  const handlePress = () => {
    if (animating.current) return;
    if (reduceMotion) {
      onPress();
      return;
    }
    animating.current = true;
    Animated.sequence([
      Animated.timing(tapProgress, { toValue: 0, duration: 80, useNativeDriver: true }),
      Animated.timing(tapProgress, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start(({ finished }) => {
      animating.current = false;
      if (finished) onPress();
    });
  };
  if (animateOnPress) {
    return <Animated.View style={{
      opacity: tapProgress.interpolate({ inputRange: [0, 1], outputRange: [.92, 1] }),
      transform: [{ translateX: tapProgress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
    }}>
      <Pressable onPress={handlePress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
        style={style}>{children}</Pressable>
    </Animated.View>;
  }
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    style={({ pressed }) => [style, { opacity: pressed ? .9 : 1, transform: [{ scale: pressed && !reduceMotion ? .985 : 1 }] }]}>{children}</Pressable>;
}

/** logo 的书脊：顶部圆、底部方的豆沙粉竖条，中文按字竖排。 */
export function Spine({ label, style }: { label: string; style?: StyleProp<ViewStyle> }) {
  const { theme } = useAppTheme();
  return <View style={[styles.spine, { backgroundColor: theme.pink }, style]}>
    <Text style={[styles.spineText, { color: theme.onPink }]}>{label}</Text>
  </View>;
}

function useLayoutSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(current => current.width === width && current.height === height ? current : { width, height });
  };
  return [size, onLayout] as const;
}

const TAN_TILT = Math.tan(Math.PI / 9);

/** logo 构图：朱橙椭圆在后，豆沙粉楔形以 20° 斜边压在前面。纯装饰，铺满父容器。 */
export function LogoPlanes({ split = 0.62, level = 0.4 }: { split?: number; level?: number }) {
  const { theme } = useAppTheme();
  const [{ width: w, height: h }, onLayout] = useLayoutSize();
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    onLayout={onLayout} style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
    {w > 0 ? <>
      <View style={{ position: 'absolute', left: w * 0.46, top: -h * 0.05, width: w * 0.66, height: h * 1.1, borderRadius: '50%', backgroundColor: theme.vermilion, transform: [{ rotate: orbitTilt }] }} />
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: w * split, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: -w / 2, top: h * level + (w / 2) * TAN_TILT, width: w * 2, height: (w + h) * 2, backgroundColor: theme.pink, transformOrigin: 'left top', transform: [{ rotate: '-20deg' }] }} />
      </View>
    </> : null}
  </View>;
}

const ORBIT_SLOTS = {
  near: { r: 0.4, angles: [200, 20, 115, 295, 65] },
  mid: { r: 0.66, angles: [160, 340, 235, 50] },
  far: { r: 0.93, angles: [188, 8, 262, 98] },
};

/** 记忆轨道：logo 的 20° 椭圆，越靠近中心越该复习。点数只表示各组是否有词（每组最多 5/4/4 个）。 */
export function OrbitMap({ due, learning, mastered }: { due: number; learning: number; mastered: number }) {
  const { theme } = useAppTheme();
  const [{ width: w }, onLayout] = useLayoutSize();
  const h = w / 2;
  const hole = theme.mode === 'dark' ? theme.bg : theme.text;
  const a = w * 0.48, b = w * 0.16, cos = Math.cos(Math.PI / 9), sin = Math.sin(Math.PI / 9);
  const dots = ([['near', due, theme.vermilion, 11], ['mid', learning, theme.pink, 9], ['far', mastered, theme.textMuted, 6]] as const)
    .flatMap(([group, count, color, size]) => ORBIT_SLOTS[group].angles.slice(0, Math.min(count, ORBIT_SLOTS[group].angles.length)).map((deg, i) => {
      const t = deg * Math.PI / 180, x = ORBIT_SLOTS[group].r * a * Math.cos(t), y = ORBIT_SLOTS[group].r * b * Math.sin(t);
      return { key: `${group}${i}`, color, size, left: w / 2 + x * cos - y * sin - size / 2, top: h / 2 + x * sin + y * cos - size / 2 };
    }));
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    onLayout={onLayout} style={{ width: '100%', aspectRatio: 2 }}>
    {w > 0 ? <>
      <View style={{ position: 'absolute', left: w / 2 - a, top: h / 2 - b, width: a * 2, height: b * 2, borderRadius: '50%', backgroundColor: theme.marker, transform: [{ rotate: orbitTilt }] }} />
      <View style={{ position: 'absolute', left: w / 2 - w * 0.1, top: h / 2 - w * 0.06, width: w * 0.2, height: w * 0.12, borderRadius: '50%', backgroundColor: hole, transform: [{ rotate: orbitTilt }] }} />
      {dots.map(dot => <View key={dot.key} style={{ position: 'absolute', left: dot.left, top: dot.top, width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: dot.color, opacity: dot.size === 6 ? 0.55 : 1 }} />)}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 16, minHeight: 64 },
  brand: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  brandName: { fontSize: 17, fontWeight: weight('semibold') },
  headerAction: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginBottom: 20 },
  title: { fontSize: 32, lineHeight: 40, fontWeight: weight('bold') },
  description: { fontSize: 13, lineHeight: 20 },
  stats: { flexDirection: 'row', gap: 3, marginVertical: 22 },
  stat: { flex: 1, minWidth: 0, borderRadius: radius.content, paddingHorizontal: 12, paddingVertical: 12 },
  statValue: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36 },
  statLabel: { fontSize: 12, marginTop: 2 },
  spine: { alignItems: 'center', paddingTop: 12, paddingBottom: 9, paddingHorizontal: 5, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: radius.content, borderBottomRightRadius: radius.content },
  spineText: { width: 14, fontSize: 12, lineHeight: 15, fontWeight: weight('semibold'), textAlign: 'center' },
});
