import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { Theme, ThemeMode, themes } from '@/constants/theme';

type Preference = 'system' | ThemeMode;

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  preference: Preference;
  setPreference: (p: Preference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = '@waikan/theme-mode';

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<Preference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') {
        setPreferenceState(v);
      }
    });
  }, []);

  const setPreference = (p: Preference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(STORAGE_KEY, p);
  };

  const mode: ThemeMode =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

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
