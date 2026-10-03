import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { AMBIENT_MOTION, useFrameLoop } from '@/components/cosmos';
import { useReducedMotion } from '@/components/motion';
import { motion } from '@/constants/theme';

export type TabIconName = 'kan' | 'shelf' | 'words' | 'bottle' | 'me' | 'material' | 'files';

/* ---------- 角标：收藏文章、加入生词本后，对应导航出现一个点，进入该页后消失 ---------- */
const badges = new Set<TabIconName>();
const badgeListeners = new Set<() => void>();
export function markTabBadge(name: TabIconName) { badges.add(name); badgeListeners.forEach((listener) => listener()); }
export function clearTabBadge(name: TabIconName) { if (badges.delete(name)) badgeListeners.forEach((listener) => listener()); }
function subscribeBadges(listener: () => void) {
  badgeListeners.add(listener);
  return () => { badgeListeners.delete(listener); };
}
export function useTabBadge(name: TabIconName) {
  return useSyncExternalStore(subscribeBadges, () => badges.has(name), () => false);
}

/* ---------- 导航项的屏幕位置：收藏时小卡片飞向这里，落下时图标轻跳 ---------- */
const anchors = new Map<TabIconName, View>();
export function tabAnchor(name: TabIconName) { return anchors.get(name) ?? null; }
const pulseListeners = new Set<(name: TabIconName) => void>();
export function pulseTab(name: TabIconName) { pulseListeners.forEach((listener) => listener(name)); }

function hex(color: string) {
  const value = color.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}
/** 两个十六进制颜色按 t 混合；不是十六进制时直接按 t 取其一。 */
export function mixColor(a: string, b: string, t: number) {
  if (!a.startsWith('#') || !b.startsWith('#')) return t < 0.5 ? a : b;
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)}, ${m(g1, g2)}, ${m(b1, b2)})`;
}

/**
 * 自绘导航图标：1.6pt 线宽、圆头；选中时主体在 160ms 内由线框填满，细节转成底色，并轻跳 2pt。
 * paper 传导航栏底色，用于选中后的细节线。
 */
export function TabIcon({ name, focused, color, paper, size = 24, badgeColor }: {
  name: TabIconName; focused: boolean; color: string; paper: string; size?: number; badgeColor?: string;
}) {
  const reduced = useReducedMotion();
  const badge = useTabBadge(name);
  const target = focused ? 1 : 0;
  // 选中状态变化时在渲染里调整补间目标；帧循环把填充量在 160ms 内推到目标。
  const [fillState, setFillState] = useState({ value: target, target });
  if (fillState.target !== target) setFillState((f) => ({ value: reduced || !AMBIENT_MOTION ? target : f.value, target }));
  const fill = fillState.value;
  const [pop] = useState(() => new Animated.Value(0));
  const anchor = useRef<View>(null);
  const mounted = useRef(false);
  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first || !focused || reduced) return;
    pop.setValue(0);
    Animated.timing(pop, { toValue: 1, duration: 280, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [focused, reduced, pop]);
  useFrameLoop(fillState.value !== fillState.target, (dt) => setFillState((f) => {
    const step = dt / motion.quick;
    const value = f.target > f.value ? Math.min(f.target, f.value + step) : Math.max(f.target, f.value - step);
    return { ...f, value };
  }));
  useEffect(() => {
    const view = anchor.current;
    if (view) anchors.set(name, view);
    return () => { if (anchors.get(name) === view) anchors.delete(name); };
  }, [name]);
  useEffect(() => { if (focused) clearTabBadge(name); }, [focused, name, badge]);
  useEffect(() => {
    const listener = (targetName: TabIconName) => {
      if (targetName !== name || reduced) return;
      pop.setValue(0);
      Animated.timing(pop, { toValue: 1, duration: 280, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
    };
    pulseListeners.add(listener);
    return () => { pulseListeners.delete(listener); };
  }, [name, pop, reduced]);
  const knock = mixColor(color, paper, fill);
  const solid = { fill: color, fillOpacity: fill, stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const line = { fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const detail = { ...line, stroke: knock };
  const shapes: Record<TabIconName, React.ReactNode> = {
    kan: <><Rect x={4.5} y={3.5} width={15} height={17} rx={3} {...solid} /><Path d="M8 8.5h8M8 12h8M8 15.5h4.5" {...detail} /></>,
    shelf: <><Rect x={3.8} y={5.2} width={4.2} height={14.6} rx={1.4} {...solid} /><Rect x={9.6} y={3.6} width={4.2} height={16.2} rx={1.4} {...solid} /><Rect x={15.1} y={5.6} width={4.2} height={14.2} rx={1.4} transform="rotate(14 17.2 19.8)" {...solid} /></>,
    words: <><Path d="M8 6.6V6a2.5 2.5 0 0 1 2.5-2.5h7A2.5 2.5 0 0 1 20 6v8a2.5 2.5 0 0 1-2.5 2.5H17" {...line} /><Rect x={4} y={7.2} width={12.6} height={13.3} rx={2.5} {...solid} /><Path d="M10.3 10.4c.3 1.7 1 2.4 2.7 2.7-1.7.3-2.4 1-2.7 2.7-.3-1.7-1-2.4-2.7-2.7 1.7-.3 2.4-1 2.7-2.7z" {...detail} /></>,
    bottle: <G transform="rotate(-38 12 12)"><Rect x={3} y={8.4} width={12.4} height={7.8} rx={3.6} {...solid} /><Path d="M15.4 10.6h2.4v3.4h-2.4" {...line} /><Rect x={17.8} y={9.8} width={2.4} height={5} rx={1} fill={color} /><Path d="M6.3 12.3h5.6" {...detail} /></G>,
    me: <><Circle cx={12} cy={8.3} r={3.8} {...solid} /><Path d="M4.8 20.2c.4-3.9 3.4-6.4 7.2-6.4s6.8 2.5 7.2 6.4z" {...solid} /></>,
    material: <><Rect x={3.5} y={5} width={17} height={14} rx={3.6} {...solid} /><Path d="M10.4 9.5v5l4.3-2.5z" {...detail} /></>,
    files: <><Path d="M3.5 8a2.5 2.5 0 0 1 2.5-2.5h3.4a1.6 1.6 0 0 1 1.1.5l1.4 1.5H18a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z" {...solid} /><Path d="M9 12.6v3M12 11.2v5.8M15 12.9v2.4" {...detail} /></>,
  };
  return <Animated.View ref={anchor} collapsable={false} style={{ transform: [
    { translateY: pop.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, -2, 0] }) },
    { scale: pop.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1.1, 1] }) },
  ] }}>
    <Svg width={size} height={size} viewBox="0 0 24 24">{shapes[name]}</Svg>
    {badge && !focused ? <View style={[styles.badge, { backgroundColor: badgeColor ?? color, borderColor: paper }]} /> : null}
  </Animated.View>;
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -1, right: -3, width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
});
