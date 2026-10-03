import { Tabs } from 'expo-router';
import type { BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { PlatformPressable } from 'expo-router/react-navigation';
import { useLayoutWidth } from '@/components/useLayoutWidth';
import React from 'react';
import { ColorValue, Platform, StatusBar, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabIcon, type TabIconName } from '@/components/tabIcons';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import { useLearningMode } from '@/context/LearningModeContext';
import { modeAccent } from '@/context/modeAccent';

function SidebarTabButton({ style, ...props }: BottomTabBarButtonProps) {
  return <PlatformPressable {...props} style={[style, { borderRadius: 16 }]} />;
}

function TabLabel({ focused, color, children }: { focused: boolean; color: ColorValue; children: string }) {
  return <Text style={{ color, fontSize: 11, marginTop: 3, fontWeight: weight(focused ? 'semibold' : 'regular') }}>{children}</Text>;
}

/** 底部导航（宽屏为侧栏）：自绘图标，选中时图标填满模式色；侧栏图标在上、文字横排在下。 */
export default function TabLayout() {
  const { theme } = useAppTheme();
  const { mode } = useLearningMode();
  const speaking = mode === 'speak';
  const accent = modeAccent(theme, mode);
  const width = useLayoutWidth();
  const insets = useSafeAreaInsets();
  const wide = width >= 768;
  const icon = (name: TabIconName) => function TabBarIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    return <TabIcon name={name} focused={focused} color={String(color)} paper={wide && focused ? accent.soft : theme.tabBar} />;
  };
  // 导航栏与页面用不同的底色区分，再加一层很淡的阴影，不画分隔线。
  const lift = Platform.select({
    web: { boxShadow: wide ? '1px 0 24px -18px rgba(34, 23, 26, 0.45)' : '0 -8px 24px -18px rgba(34, 23, 26, 0.45)' },
    ios: { shadowColor: '#22171A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: wide ? 2 : 0, height: wide ? 0 : -4 } },
    default: {},
  });

  return (
    <>
      <StatusBar barStyle={theme.statusBar} />
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarPosition: wide ? 'left' : 'bottom',
          tabBarVariant: wide ? 'material' : 'uikit',
          tabBarButton: wide ? SidebarTabButton : undefined,
          tabBarLabelPosition: 'below-icon',
          tabBarActiveTintColor: accent.ink,
          tabBarInactiveTintColor: theme.textMuted,
          tabBarActiveBackgroundColor: wide ? accent.soft : 'transparent',
          tabBarLabel: ({ focused, color, children }) => <TabLabel focused={focused} color={color}>{children}</TabLabel>,
          tabBarStyle: {
            backgroundColor: theme.tabBar,
            borderTopWidth: 0,
            elevation: 0,
            ...lift,
            ...(wide ? {
              width: 96,
              minWidth: 96,
              paddingStart: 8,
              paddingEnd: 8,
              borderRightWidth: 0,
              paddingTop: insets.top + 32,
              paddingBottom: insets.bottom + 24,
            } : { height: 58 + insets.bottom, paddingTop: 8, paddingBottom: Math.max(10, insets.bottom) }),
          },
          tabBarItemStyle: [
            { minHeight: wide ? 64 : 44 },
            wide && { marginVertical: 4, borderRadius: 16, paddingVertical: 8 },
            // 两处自动留白让主导航在「我的」上方居中，个人入口贴近底部安全区。
            wide && (route.name === 'index' || route.name === 'profile') && { marginTop: 'auto' },
          ],
          sceneStyle: { backgroundColor: theme.bg },
        })}>
        <Tabs.Screen
          name="index"
          options={{ title: speaking ? '素材' : '外刊', tabBarIcon: icon(speaking ? 'material' : 'kan') }}
        />
        <Tabs.Screen
          name="shelf"
          options={{ title: speaking ? '文件' : '书架', tabBarIcon: icon(speaking ? 'files' : 'shelf') }}
        />
        <Tabs.Screen
          name="words"
          options={{ title: '词库', tabBarIcon: icon('words'), ...(speaking ? { href: null } : {}) }}
        />
        <Tabs.Screen
          name="message-bottles"
          options={{ title: '留言瓶', tabBarIcon: icon('bottle') }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: '我的', tabBarIcon: icon('me') }}
        />
      </Tabs>
    </>
  );
}

