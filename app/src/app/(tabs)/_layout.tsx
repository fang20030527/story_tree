import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useLayoutWidth } from '@/components/useLayoutWidth';
import React from 'react';
import { ColorValue, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/context/ThemeContext';
import { useLearningMode } from '@/context/LearningModeContext';

function ModeTabIcon({ name, oralName, color, size }: { name: keyof typeof Ionicons.glyphMap; oralName?: keyof typeof Ionicons.glyphMap; color: ColorValue; size: number }) {
  const { mode } = useLearningMode();
  const glyph = mode === 'speak' && oralName ? oralName : name;
  return <Ionicons name={`${glyph}-outline` as keyof typeof Ionicons.glyphMap} size={size} color={color} />;
}
const tabIcon = (name: keyof typeof Ionicons.glyphMap, oralName?: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({
    color,
    size,
  }: {
    color: ColorValue;
    size: number;
    focused: boolean;
  }) => (
    <ModeTabIcon
      name={name}
      oralName={oralName}
      size={size}
      color={color}
    />
  );
  TabIcon.displayName = `TabIcon(${String(name)})`;
  return TabIcon;
};

export default function TabLayout() {
  const { theme } = useAppTheme();
  const { mode } = useLearningMode();
  const speaking = mode === 'speak';
  const width = useLayoutWidth();
  const insets = useSafeAreaInsets();
  const wide = width >= 768;

  return (
    <>
      <StatusBar barStyle={theme.statusBar} />
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarPosition: wide ? 'left' : 'bottom',
          tabBarVariant: wide ? 'material' : 'uikit',
          tabBarLabelPosition: wide && width >= 1100 ? 'beside-icon' : 'below-icon',
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.textMuted,
          tabBarStyle: {
            backgroundColor: theme.tabBar,
            borderTopColor: theme.border,
            borderTopWidth: 0.5,
            ...(wide ? {
              width: width >= 1100 ? 100 : 92,
              minWidth: width >= 1100 ? 100 : 92,
              ...(width >= 1100 ? { paddingStart: 4, paddingEnd: 4 } : {}),
              borderTopWidth: 0,
              borderRightWidth: 0.5,
              borderRightColor: theme.border,
              paddingTop: insets.top + 32,
              paddingBottom: insets.bottom + 24,
            } : { height: 64 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(6, insets.bottom) }),
          },
          tabBarLabelStyle: {
            fontSize: 11,
            marginTop: 2,
            ...(wide && width >= 1100 ? { marginStart: 4, marginEnd: 0 } : {}),
          },
          tabBarItemStyle: [
            { minHeight: wide ? 70 : 52 },
            wide && { marginVertical: 6 },
            // 两处自动留白让主导航在「我的」上方居中，个人入口贴近底部安全区。
            wide && (route.name === 'index' || route.name === 'profile') && { marginTop: 'auto' },
          ],
          sceneStyle: { backgroundColor: theme.bg },
        })}>
        <Tabs.Screen
          name="index"
          options={{ title: speaking ? '素材' : '外刊', tabBarIcon: tabIcon('newspaper', 'mic') }}
        />
        <Tabs.Screen
          name="shelf"
          options={{ title: speaking ? '文件' : '书架', tabBarIcon: tabIcon('book', 'folder') }}
        />
        <Tabs.Screen
          name="words"
          options={{ title: '词库', tabBarIcon: tabIcon('albums'), ...(speaking ? { href: null } : {}) }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: '我的', tabBarIcon: tabIcon('person') }}
        />
      </Tabs>
    </>
  );
}
