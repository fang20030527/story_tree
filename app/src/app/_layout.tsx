import { Stack } from 'expo-router';
import React from 'react';

import { AppThemeProvider } from '@/context/ThemeContext';

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="login"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="import"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="import-processing" />
        <Stack.Screen name="import-preview" />
        <Stack.Screen name="import-computer" />
        <Stack.Screen name="article-read" />
        <Stack.Screen name="vocabulary/book" />
        <Stack.Screen name="editorial/[id]/index" />
        <Stack.Screen name="editorial/[id]/read" />
        <Stack.Screen name="recent" />
        <Stack.Screen name="favorites" />
        <Stack.Screen name="feature-guide" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="pro" />
      </Stack>
    </AppThemeProvider>
  );
}
