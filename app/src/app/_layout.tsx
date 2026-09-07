import { Stack } from 'expo-router';
import React from 'react';

import { AppThemeProvider } from '@/context/ThemeContext';

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </AppThemeProvider>
  );
}
