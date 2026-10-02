import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, LayoutAnimation, Platform, Pressable,
  type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native';

/** 系统“减少动态效果”。读取完成前按开启处理，避免首帧出现不受控的动画。 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    // 部分运行环境（含测试替身）不返回 Promise，统一包装后再读取。
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then((value) => { if (active) setReduced(Boolean(value)); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription?.remove(); };
  }, []);
  return reduced;
}

/** 在下一次布局变化前调用，让展开收起平滑过渡；Web 与减少动态效果时直接切换。 */
export function animateNextLayout(reduced: boolean) {
  if (reduced || Platform.OS === 'web') return;
  LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}

type PressFeedbackProps = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; containerStyle?: StyleProp<ViewStyle>; children: React.ReactNode };

/** 按压时轻微变暗、缩小；减少动态效果时只变暗，不缩放。 */
/** style 作用于内容（可动画），containerStyle 作用于外层按压区域（参与父级布局，如 flex: 1）。 */
export function PressFeedback({ style, containerStyle, children, onPressIn, onPressOut, disabled, ...props }: PressFeedbackProps) {
  const reduced = useReducedMotion();
  const [pressed] = useState(() => new Animated.Value(0));
  const to = (value: number) => Animated.timing(pressed, { toValue: value, duration: value ? 70 : 140, useNativeDriver: Platform.OS !== 'web' }).start();
  return <Pressable {...props} disabled={disabled} style={containerStyle}
    onPressIn={(event) => { to(1); onPressIn?.(event); }}
    onPressOut={(event) => { to(0); onPressOut?.(event); }}>
    <Animated.View style={[style, {
      opacity: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.62] }),
      transform: reduced ? [] : [{ scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }],
    }]}>{children}</Animated.View>
  </Pressable>;
}

/** trigger 变化时淡入并上移 4pt，用于当前句切换、结果出现等状态变化。 */
export function FadeOnChange({ trigger, style, children }: { trigger: unknown; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(1));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [trigger, reduced, progress]);
  return <Animated.View style={[style, {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
  }]}>{children}</Animated.View>;
}

/** 首次出现时淡入并上移 6pt，用于结果、空状态等一次性出现的内容。 */
export function FadeIn({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) { progress.setValue(1); return; }
    const animation = Animated.timing(progress, { toValue: 1, duration: 260, delay, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [reduced, delay, progress]);
  return <Animated.View style={[style, {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
  }]}>{children}</Animated.View>;
}
