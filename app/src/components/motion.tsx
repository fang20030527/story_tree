import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo, Animated, LayoutAnimation, Platform, Pressable,
  type PressableProps, type StyleProp, type View, type ViewStyle,
} from 'react-native';

import { motion } from '@/constants/theme';

/*
 * 系统“减少动态效果”。偏好只在启动时读一次并缓存，之后新挂载的组件同步拿到结果；
 * 读取完成前按开启处理，避免首帧出现不受控的动画。
 */
let reducedCache: boolean | null = null;
let queryStarted = false;
const reducedListeners = new Set<() => void>();
function publishReduced(value: boolean) {
  reducedCache = value;
  reducedListeners.forEach((listener) => listener());
}
export function preloadReducedMotion() {
  if (queryStarted) return;
  queryStarted = true;
  // 部分运行环境（含测试替身）不返回 Promise，统一包装后再读取。
  void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then((value) => publishReduced(Boolean(value))).catch(() => undefined);
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => publishReduced(Boolean(value)));
}
function subscribeReduced(listener: () => void) {
  reducedListeners.add(listener);
  return () => { reducedListeners.delete(listener); };
}
const readReduced = () => reducedCache ?? true;

export function useReducedMotion(): boolean {
  preloadReducedMotion();
  return useSyncExternalStore(subscribeReduced, readReduced, readReduced);
}

/** 挂载时是否已经确定可以播放动效（偏好已读出且未开启“减少动态效果”）。入场动效只在这种情况下播放。 */
export function motionAllowedNow(): boolean {
  return reducedCache === false;
}

/** 在下一次布局变化前调用，让展开收起平滑过渡；Web 与减少动态效果时直接切换。 */
export function animateNextLayout(reduced: boolean) {
  if (reduced || Platform.OS === 'web') return;
  LayoutAnimation.configureNext(LayoutAnimation.create(motion.base, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}

type PressFeedbackProps = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; containerStyle?: StyleProp<ViewStyle>; children: React.ReactNode; ref?: React.Ref<View> };

/**
 * 按压反馈：缩到 0.97、透明度 0.86；按下 100ms，松开 160ms。减少动态效果时只变暗，不缩放。
 * style 作用于内容（可动画），containerStyle 作用于外层按压区域（参与父级布局，如 flex: 1）。
 */
export function PressFeedback({ style, containerStyle, children, onPressIn, onPressOut, disabled, ref, ...props }: PressFeedbackProps) {
  const reduced = useReducedMotion();
  const [pressed] = useState(() => new Animated.Value(0));
  const to = (value: number) => Animated.timing(pressed, {
    toValue: value, duration: value ? motion.press : motion.quick, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web',
  }).start();
  return <Pressable {...props} ref={ref} disabled={disabled} style={containerStyle}
    onPressIn={(event) => { to(1); onPressIn?.(event); }}
    onPressOut={(event) => { to(0); onPressOut?.(event); }}>
    <Animated.View style={[style, {
      opacity: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }),
      transform: reduced ? [] : [{ scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }],
    }]}>{children}</Animated.View>
  </Pressable>;
}

/** trigger 变化时淡入并上移 4pt（240ms），用于当前句切换、结果出现等状态变化。 */
export function FadeOnChange({ trigger, style, children }: { trigger: unknown; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(1));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: motion.base, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [trigger, reduced, progress]);
  return <Animated.View style={[style, {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
  }]}>{children}</Animated.View>;
}

/** 首次出现时淡入并上移 4pt（240ms），用于结果、空状态等一次性出现的内容。偏好未知或减少动态效果时直接显示。 */
export function FadeIn({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const [animate] = useState(motionAllowedNow);
  const [progress] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: motion.base, delay, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [animate, delay, progress]);
  return <Animated.View style={[style, {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
  }]}>{children}</Animated.View>;
}
