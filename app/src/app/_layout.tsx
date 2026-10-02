import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { useFonts } from 'expo-font';
import { ResponsiveFrame } from '@/components/ResponsiveFrame';

import { AppThemeProvider } from '@/context/ThemeContext';
import { LearningModeProvider, useLearningMode } from '@/context/LearningModeContext';
import { EditorialAudioProvider, useEditorialAudio } from '@/features/editorial/EditorialAudioProvider';
import { FloatingEditorialAudioPlayer } from '@/features/editorial/FloatingEditorialAudioPlayer';

function ModeAudioOverlay() {
  const { mode } = useLearningMode();
  const { close } = useEditorialAudio();
  useEffect(() => { if (mode === 'speak') close(); }, [mode, close]);
  return mode === 'read' ? <FloatingEditorialAudioPlayer /> : null;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    ...(Platform.OS === 'web' ? Ionicons.font : {}),
    HeidongBrand: require('../../assets/fonts/HeidongBrand-Bold.ttf'),
    HeidongBrandSemiBold: require('../../assets/fonts/HeidongBrand-SemiBold.ttf'),
    HeidongReading: require('../../assets/fonts/HeidongReading-Regular.ttf'),
    HeidongReadingMedium: require('../../assets/fonts/HeidongReading-Medium.ttf'),
    HeidongReadingSemiBold: require('../../assets/fonts/HeidongReading-SemiBold.ttf'),
  });
  if (Platform.OS !== 'web' && !loaded && !error) return null;
  return (
    <AppThemeProvider>
      <LearningModeProvider>
      <EditorialAudioProvider>
        <ResponsiveFrame>
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
          <ModeAudioOverlay />
        </ResponsiveFrame>
      </EditorialAudioProvider>
      </LearningModeProvider>
    </AppThemeProvider>
  );
}
