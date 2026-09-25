import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Appearance, Platform } from 'react-native';

import { Theme, ThemeMode, themes } from '@/constants/theme';

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  preference: ThemeMode;
  setPreference: (p: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = '@waikan/theme-mode';

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemeMode>('light');
  const changedByUser = useRef(false);

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      if (!mounted || changedByUser.current) return;
      if (value === 'dark') setPreferenceState('dark');
      if (value === 'system') {
        void AsyncStorage.setItem(STORAGE_KEY, 'light').catch(() => {});
      }
    }).catch(() => {
      // 读取失败时继续使用默认浅色。
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme(preference);
  }, [preference]);

  const setPreference = (p: ThemeMode) => {
    changedByUser.current = true;
    setPreferenceState(p);
    void AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  };

  const mode = preference;

  return (
    <ThemeContext.Provider value={{ theme: themes[mode], mode, preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppTheme must be used within AppThemeProvider');
  return ctx;
}
