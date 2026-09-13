import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue, StatusBar } from 'react-native';

import { useAppTheme } from '@/context/ThemeContext';

const tabIcon = (name: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({
    color,
    size,
    focused,
  }: {
    color: ColorValue;
    size: number;
    focused: boolean;
  }) => (
    <Ionicons
      name={focused ? name : (`${name}-outline` as keyof typeof Ionicons.glyphMap)}
      size={size}
      color={color}
    />
  );
  TabIcon.displayName = `TabIcon(${String(name)})`;
  return TabIcon;
};

export default function TabLayout() {
  const { theme } = useAppTheme();

  return (
    <>
      <StatusBar barStyle={theme.statusBar} />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.textMuted,
          tabBarStyle: {
            backgroundColor: theme.tabBar,
            borderTopColor: theme.border,
            borderTopWidth: 0.5,
            height: 84,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 11, marginTop: 2 },
          sceneStyle: { backgroundColor: theme.bg },
        }}>
        <Tabs.Screen
          name="index"
          options={{ title: '外刊', tabBarIcon: tabIcon('newspaper') }}
        />
        <Tabs.Screen
          name="shelf"
          options={{ title: '书架', tabBarIcon: tabIcon('book') }}
        />
        <Tabs.Screen
          name="words"
          options={{ title: '词库', tabBarIcon: tabIcon('albums') }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: '我的', tabBarIcon: tabIcon('person') }}
        />
      </Tabs>
    </>
  );
}
