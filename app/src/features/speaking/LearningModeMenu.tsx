import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { useLearningMode, type LearningMode } from '@/context/LearningModeContext';

export function LearningModeMenu() {
  const { theme } = useAppTheme();
  const { mode, setMode } = useLearningMode();
  const [open, setOpen] = useState(false);
  const trigger = useRef<React.ElementRef<typeof View>>(null);
  const options = useRef<(React.ElementRef<typeof View> | null)[]>([]);
  const close = () => { setOpen(false); if (Platform.OS === 'web') trigger.current?.focus(); };
  return <>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={`我的，当前为${mode === 'read' ? '阅读' : '口语'}模式，切换学习模式`} aria-expanded={open} aria-haspopup="dialog" accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={styles.trigger}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 28 }}>我的</Text><View style={[styles.badge, { backgroundColor: mode === 'read' ? theme.pink : theme.accentSoft }]}><Text style={{ color: mode === 'read' ? theme.onPink : theme.accent, fontSize: 12 }}>{mode === 'read' ? '阅读' : '口语'}</Text></View><Ionicons name="chevron-down" color={theme.textMuted} size={16} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <Pressable accessibilityLabel="关闭模式菜单" onPress={close} style={styles.backdrop}>
        <Pressable onPress={event => event.stopPropagation()} {...(Platform.OS === 'web' ? { onKeyDown: (event: React.KeyboardEvent) => {
          const key = event.nativeEvent.key;
          if (key === 'Escape') { event.preventDefault(); close(); }
        } } : {})} style={[styles.menu, { backgroundColor: theme.bg, borderColor: theme.border }]}>
          <Text style={{ color: theme.textMuted, fontSize: 12, padding: 16 }}>学习模式</Text>
          {(['read', 'speak'] as LearningMode[]).map((value, index) => <Pressable key={value} ref={element => { options.current[index] = element; }} accessibilityRole="radio" aria-checked={mode === value} accessibilityState={{ checked: mode === value }} accessibilityLabel={`${value === 'read' ? '阅读' : '口语'}模式`} {...(Platform.OS === 'web' ? { onKeyDown: (event: React.KeyboardEvent) => {
            const key = event.nativeEvent.key;
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) { event.preventDefault(); options.current[key === 'Home' ? 0 : key === 'End' ? 1 : (index + 1) % 2]?.focus(); }
          } } : {})} onPress={() => { setMode(value); close(); }} style={[styles.option, { backgroundColor: mode === value ? theme.accentSoft : theme.bg }]}>
            <Ionicons name={value === 'read' ? 'book-outline' : 'mic-outline'} color={theme.accent} size={24} /><View style={{ flex: 1 }}><Text style={{ color: theme.text, fontSize: 17 }}>{value === 'read' ? '阅读' : '口语'}</Text><Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 6 }}>{value === 'read' ? '外刊阅读 · 词汇积累' : '影子跟读 · 开口表达'}</Text></View>{mode === value ? <Ionicons name="checkmark" color={theme.accent} size={22} /> : null}
          </Pressable>)}
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }, badge: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 3 },
  backdrop: { flex: 1, justifyContent: 'flex-start', backgroundColor: '#00000033', paddingTop: 80, paddingHorizontal: 24 },
  menu: { maxWidth: 360, width: '100%', borderWidth: 1, borderRadius: 4, overflow: 'hidden' }, option: { minHeight: 84, padding: 16, gap: 16, flexDirection: 'row', alignItems: 'center' },
});
