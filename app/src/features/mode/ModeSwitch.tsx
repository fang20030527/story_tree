import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlackHole, GlyphRead, GlyphSpeak, VoicePlanet } from '@/components/cosmos';
import { PressFeedback, useReducedMotion } from '@/components/motion';
import { motion, radius, weight } from '@/constants/theme';
import type { LearningMode } from '@/context/LearningModeContext';
import { modeAccent, useModeState } from '@/context/modeAccent';
import { useAppTheme } from '@/context/ThemeContext';

const NATIVE = Platform.OS !== 'web';
const MODE_COPY: Record<LearningMode, { title: string; sub: string }> = {
  read: { title: '阅读', sub: '外刊 · 书架 · 词库' },
  speak: { title: '口语', sub: '素材 · 文件 · 跟读' },
};

/** 模式值 0（阅读）↔ 1（口语）之间的补间；减少动态效果时直接切换。 */
function useModeProgress(mode: LearningMode) {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(mode === 'speak' ? 1 : 0));
  useEffect(() => {
    const to = mode === 'speak' ? 1 : 0;
    if (reduced) { value.setValue(to); return; }
    Animated.timing(value, { toValue: to, duration: motion.gentle, easing: motion.easeInOut, useNativeDriver: false }).start();
  }, [mode, reduced, value]);
  return value;
}

/**
 * 首页顶部的模式胶囊：两个星体沿 20° 轨道互换位置（360ms），文字交叉淡入；点开是模式选择面板。
 */
export function ModeCapsule() {
  const { theme } = useAppTheme();
  const { mode } = useModeState();
  const [open, setOpen] = useState(false);
  const progress = useModeProgress(mode);
  const read = modeAccent(theme, 'read');
  const speak = modeAccent(theme, 'speak');
  const background = progress.interpolate({ inputRange: [0, 1], outputRange: [read.soft, speak.soft] });
  const ink = mode === 'speak' ? speak.ink : read.ink;
  const seam = mode === 'speak' ? speak.soft : read.soft;
  return <>
    <PressFeedback accessibilityRole="button" accessibilityLabel={`切换学习模式，当前${MODE_COPY[mode].title}`} onPress={() => setOpen(true)} hitSlop={6}>
      <Animated.View style={[styles.capsule, { backgroundColor: background }]}>
        <View style={styles.glyphs}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, {
            opacity: progress.interpolate({ inputRange: [0, 0.8], outputRange: [1, 0], extrapolate: 'clamp' }),
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -3.6] }) },
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) },
            ] }]}><GlyphRead size={28} seam={seam} /></Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, {
            opacity: progress.interpolate({ inputRange: [0.2, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [3.6, 0] }) },
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
            ] }]}><GlyphSpeak size={28} /></Animated.View>
        </View>
        <Text style={[styles.capsuleLabel, { color: ink }]}>{MODE_COPY[mode].title}</Text>
        <Ionicons name="chevron-down" size={13} color={ink} />
      </Animated.View>
    </PressFeedback>
    <ModeSheet visible={open} onClose={() => setOpen(false)} />
  </>;
}

/** 模式选项：星体、名称、包含的页面；选中时用该模式的浅底和勾，星体动一下就停。 */
export function ModeOption({ value, layout = 'tile', onSelect }: { value: LearningMode; layout?: 'tile' | 'row'; onSelect: (mode: LearningMode) => void }) {
  const { theme } = useAppTheme();
  const { mode } = useModeState();
  const selected = mode === value;
  const accent = modeAccent(theme, value);
  const background = selected ? accent.soft : theme.surfaceAlt;
  // 刚被选中时星体动一下：在渲染时和上一次的选中状态比较。
  const [pulse, setPulse] = useState(0);
  const [wasSelected, setWasSelected] = useState(selected);
  if (selected !== wasSelected) {
    setWasSelected(selected);
    if (selected) setPulse((n) => n + 1);
  }
  const emblemSize = layout === 'row' ? 92 : 96;
  const emblem = value === 'read'
    ? <BlackHole size={emblemSize} flow="none" pulseKey={pulse} seam={background} />
    : <VoicePlanet size={emblemSize} exciteKey={pulse} seam={background} />;
  return <PressFeedback accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected}
    accessibilityLabel={`${MODE_COPY[value].title}模式，${MODE_COPY[value].sub}`} onPress={() => onSelect(value)}
    containerStyle={layout === 'tile' ? styles.tileWrap : undefined}
    style={[layout === 'tile' ? styles.tile : styles.row, { backgroundColor: background }]}>
    <View style={layout === 'tile' ? styles.tileArt : styles.rowArt}>{emblem}</View>
    <View style={layout === 'row' ? styles.rowCopy : undefined}>
      <Text style={[styles.optionTitle, { color: selected ? accent.ink : theme.text }]}>{MODE_COPY[value].title}</Text>
      <Text style={[styles.optionSub, { color: theme.textMuted }]}>{MODE_COPY[value].sub}</Text>
    </View>
    <View style={[styles.check, { backgroundColor: selected ? accent.ink : theme.bg }]}>
      {selected ? <Ionicons name="checkmark" size={14} color={theme.bg} /> : null}
    </View>
  </PressFeedback>;
}

/** 「我的」里的模式卡片：两张并排，点哪张就切到哪种模式。 */
export function ModeCards() {
  const { theme } = useAppTheme();
  const { setMode } = useModeState();
  return <View>
    <Text style={[styles.cardsLabel, { color: theme.textMuted }]}>学习模式</Text>
    <View accessibilityRole="radiogroup" style={styles.cards}>
      <ModeOption value="read" onSelect={setMode} />
      <ModeOption value="speak" onSelect={setMode} />
    </View>
  </View>;
}

/** 模式选择面板：进入 240ms 减速，离开 200ms 加速，遮罩同步淡入淡出。 */
export function ModeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useAppTheme();
  const { setMode } = useModeState();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (visible) {
      progress.setValue(0);
      Animated.timing(progress, { toValue: 1, duration: reduced ? 120 : motion.base, easing: motion.easeOut, useNativeDriver: NATIVE }).start();
      return;
    }
    Animated.timing(progress, { toValue: 0, duration: reduced ? 120 : motion.leave, easing: motion.easeIn, useNativeDriver: NATIVE }).start(({ finished }) => { if (finished) setMounted(false); });
  }, [visible, reduced, progress]);
  const choose = (value: LearningMode) => { setMode(value); onClose(); };
  return <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20, 13, 16, 0.42)', opacity: progress }]}>
      <Pressable accessibilityLabel="关闭模式选择" onPress={onClose} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <View pointerEvents="box-none" style={styles.sheetDock}>
    <Animated.View accessibilityViewIsModal style={[styles.sheet, {
      backgroundColor: theme.surface, paddingBottom: Math.max(24, insets.bottom + 12),
      opacity: reduced ? progress : 1,
      transform: reduced ? [] : [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
    }]}>
      <View style={[styles.grip, { backgroundColor: theme.border }]} />
      <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.text }]}>学习模式</Text>
      <Text style={[styles.sheetHint, { color: theme.textMuted }]}>导航和首页跟着模式切换；学习记录、VIP 和留言瓶两种模式通用。</Text>
      <View accessibilityRole="radiogroup" style={styles.sheetOptions}>
        <ModeOption value="read" layout="row" onSelect={choose} />
        <ModeOption value="speak" layout="row" onSelect={choose} />
      </View>
    </Animated.View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 32, paddingLeft: 5, paddingRight: 10, borderRadius: radius.pill },
  glyphs: { width: 28, height: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },
  capsuleLabel: { fontSize: 13.5, fontWeight: weight('semibold') },
  cardsLabel: { fontSize: 13, marginBottom: 8 },
  cards: { flexDirection: 'row', gap: 10 },
  tileWrap: { flex: 1 },
  tile: { borderRadius: 18, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, minHeight: 132 },
  tileArt: { height: 62, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  row: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowArt: { width: 96, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1 },
  optionTitle: { fontSize: 15.5, fontWeight: weight('semibold') },
  optionSub: { fontSize: 11.5, marginTop: 2 },
  check: { position: 'absolute', top: 9, right: 9, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sheetDock: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 20, paddingTop: 10, width: '100%', maxWidth: 560 },
  grip: { width: 38, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: weight('semibold') },
  sheetHint: { fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 14 },
  sheetOptions: { gap: 10 },
});
