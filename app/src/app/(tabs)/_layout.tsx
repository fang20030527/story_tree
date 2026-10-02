import { Tabs } from 'expo-router';
import type { BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { PlatformPressable } from 'expo-router/react-navigation';
import { useLayoutWidth } from '@/components/useLayoutWidth';
import React from 'react';
import { ColorValue, StatusBar, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { orbitTilt, radius, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { useLearningMode } from '@/context/LearningModeContext';

function SidebarTabButton({ style, ...props }: BottomTabBarButtonProps) {
  return <PlatformPressable {...props} style={[style, { borderRadius: radius.pill }]} />;
}

function TabOrbit({ focused }: { focused: boolean }) {
  const { theme } = useAppTheme();
  return <View style={{ width: 14, height: 5, borderRadius: '50%', backgroundColor: focused ? theme.vermilion : 'transparent', transform: [{ rotate: orbitTilt }] }} />;
}
const tabOrbit = ({ focused }: { focused: boolean }) => <TabOrbit focused={focused} />;

function TabLabel({ focused, color, children, beside }: { focused: boolean; color: ColorValue; children: string; beside: boolean }) {
  return <Text style={{ color, fontSize: 12, fontWeight: weight(focused ? 'semibold' : 'regular'), ...(beside ? { marginStart: 8 } : { marginTop: 4 }) }}>{children}</Text>;
}

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
          tabBarButton: wide ? SidebarTabButton : undefined,
          tabBarLabelPosition: wide && width >= 1100 ? 'beside-icon' : 'below-icon',
          tabBarActiveTintColor: theme.text,
          tabBarInactiveTintColor: theme.textMuted,
          tabBarActiveBackgroundColor: wide ? theme.surfaceAlt : 'transparent',
          tabBarIcon: tabOrbit,
          tabBarIconStyle: { height: 8, minHeight: 8 },
          tabBarLabel: ({ focused, color, children }) => <TabLabel focused={focused} color={color} beside={wide && width >= 1100}>{children}</TabLabel>,
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
            } : { height: 56 + insets.bottom, paddingTop: 10, paddingBottom: Math.max(10, insets.bottom) }),
          },
          tabBarItemStyle: [
            { minHeight: wide ? 56 : 44 },
            wide && { marginVertical: 4, borderRadius: radius.pill },
            // 两处自动留白让主导航在「我的」上方居中，个人入口贴近底部安全区。
            wide && (route.name === 'index' || route.name === 'profile') && { marginTop: 'auto' },
          ],
          sceneStyle: { backgroundColor: theme.bg },
        })}>
        <Tabs.Screen
          name="index"
          options={{ title: speaking ? '素材' : '外刊' }}
        />
        <Tabs.Screen
          name="shelf"
          options={{ title: speaking ? '文件' : '书架' }}
        />
        <Tabs.Screen
          name="words"
          options={{ title: '词库', ...(speaking ? { href: null } : {}) }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: '我的' }}
        />
      </Tabs>
    </>
  );
}
