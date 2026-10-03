import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { motionAllowedNow } from '@/components/motion';
import { markTabBadge, pulseTab, tabAnchor, type TabIconName } from '@/components/tabIcons';
import { motion } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

type Box = { x: number; y: number; width: number; height: number };
type Flight = { id: number; from: Box; to: Box; tab: TabIconName; image?: ImageSourcePropType };
const flightListeners = new Set<(flight: Flight) => void>();
let nextFlightId = 1;

function measure(view: View | null): Promise<Box | null> {
  return new Promise((resolve) => {
    if (!view || typeof view.measureInWindow !== 'function') { resolve(null); return; }
    view.measureInWindow((x, y, width, height) => resolve(width || height ? { x, y, width, height } : null));
  });
}

/**
 * 收进书架、生词本：小卡片从 from 沿弧线飞进对应的导航图标（560ms），图标轻跳一下并出现角标。
 * 导航栏不可见、无法测量或减少动态效果时，只出现角标。
 */
export async function flyToTab(from: View | null, tab: TabIconName, image?: ImageSourcePropType) {
  const target = tabAnchor(tab);
  if (!motionAllowedNow() || !flightListeners.size) { markTabBadge(tab); return; }
  const [a, b] = await Promise.all([measure(from), measure(target)]);
  if (!a || !b) { markTabBadge(tab); return; }
  const flight: Flight = { id: nextFlightId++, from: a, to: b, tab, ...(image ? { image } : {}) };
  flightListeners.forEach((listener) => listener(flight));
}

const SAMPLES = Array.from({ length: 13 }, (_, i) => i / 12);
const CARD = { width: 34, height: 44 };

function FlyingCard({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const { theme } = useAppTheme();
  const [progress] = useState(() => new Animated.Value(0));
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: 560, easing: motion.easeInOut, useNativeDriver: Platform.OS !== 'web' });
    animation.start(({ finished }) => {
      if (!finished) return;
      markTabBadge(flight.tab);
      pulseTab(flight.tab);
      done.current();
    });
    return () => animation.stop();
  }, [flight, progress]);
  const p0 = { x: flight.from.x + flight.from.width / 2, y: flight.from.y + flight.from.height / 2 };
  const p2 = { x: flight.to.x + flight.to.width / 2, y: flight.to.y + flight.to.height / 2 };
  const p1 = { x: p0.x + 24, y: p2.y - 60 };
  const at = (t: number, k: 'x' | 'y') => (1 - t) * (1 - t) * p0[k] + 2 * (1 - t) * t * p1[k] + t * t * p2[k];
  return <Animated.View style={[styles.card, {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.bg,
    opacity: progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
    transform: [
      { translateX: progress.interpolate({ inputRange: SAMPLES, outputRange: SAMPLES.map((t) => at(t, 'x') - CARD.width / 2) }) },
      { translateY: progress.interpolate({ inputRange: SAMPLES, outputRange: SAMPLES.map((t) => at(t, 'y') - CARD.height / 2) }) },
      { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-20deg'] }) },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.26] }) },
    ],
  }]}>
    {flight.image ? <Image source={flight.image} style={styles.image} resizeMode="cover" /> : null}
  </Animated.View>;
}

/** 挂在根布局最上层，承载所有飞行中的小卡片；不拦截触摸。 */
export function AbsorbLayer() {
  const [flights, setFlights] = useState<Flight[]>([]);
  useEffect(() => {
    const listener = (flight: Flight) => setFlights((current) => [...current, flight]);
    flightListeners.add(listener);
    return () => { flightListeners.delete(listener); };
  }, []);
  if (!flights.length) return null;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {flights.map((flight) => <FlyingCard key={flight.id} flight={flight} onDone={() => setFlights((current) => current.filter((item) => item.id !== flight.id))} />)}
  </View>;
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 0, top: 0, width: CARD.width, height: CARD.height, borderRadius: 7, borderWidth: 2, overflow: 'hidden', shadowColor: '#22171A', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  image: { width: '100%', height: '100%' },
});
