import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts } from '@/constants/theme';
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
  return <View style={styles.stats}>{items.map((item, index) => <View key={item.label} style={[styles.stat, index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border }]}>
    <Text testID={item.testID} style={[styles.statValue, { color: theme.text }]}>{item.value}</Text>
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

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 16, minHeight: 64 },
  brand: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  brandName: { fontSize: 18 },
  headerAction: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 14, marginBottom: 24 },
  title: { fontSize: 34, lineHeight: 44, fontWeight: '400' },
  description: { fontSize: 12, lineHeight: 20 },
  stats: { flexDirection: 'row', marginVertical: 26 },
  stat: { flex: 1, alignItems: 'center', minWidth: 0, paddingHorizontal: 4 },
  statValue: { fontFamily: fonts.display, fontSize: 43, lineHeight: 52 },
  statLabel: { fontSize: 12, marginTop: 6, textAlign: 'center' },
});
