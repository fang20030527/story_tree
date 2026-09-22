import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/context/ThemeContext';

/** The API returns a complete page, so this bar intentionally has no percentage. */
export function VocabularyLoadingProgress({ label, startedAt }: { label: string; startedAt: number }) {
  const { theme } = useAppTheme();
  const [position] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    position.setValue(0);
    if (reduceMotion || !width) return;
    const animation = Animated.loop(Animated.timing(position, {
      toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true,
      isInteraction: false,
    }));
    animation.start();
    return () => animation.stop();
  }, [position, reduceMotion, width]);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityState={{ busy: true }}
        accessibilityValue={{ text: '加载中' }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.track, { backgroundColor: theme.accentSoft }]}>
        <Animated.View style={[styles.indicator, {
          backgroundColor: theme.accent,
          transform: [{ translateX: reduceMotion ? Math.max(0, (width - 80) / 2)
            : position.interpolate({ inputRange: [0, 1], outputRange: [-80, width] }) }],
        }]} />
      </View>
      <Text style={[styles.elapsed, { color: theme.textMuted }]}>已等待 {elapsed} 秒</Text>
      {elapsed >= 8 ? (
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          连接比平时慢，请稍候；超时后可以重试。
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', alignSelf: 'center', width: '100%', maxWidth: 280, paddingHorizontal: 12 },
  label: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  track: { width: '100%', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 16 },
  indicator: { width: 80, height: 5, borderRadius: 3 },
  elapsed: { fontSize: 12, lineHeight: 18, marginTop: 12, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'center' },
});
