import type { TextStyle } from 'react-native';

export type ThemeMode = 'light' | 'dark';

export interface Theme {
  mode: ThemeMode;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  red: string;
  danger: string;
  blue: string;
  green: string;
  tabBar: string;
  statusBar: 'light-content' | 'dark-content';
}

export const themes: Record<ThemeMode, Theme> = {
  dark: {
    mode: 'dark',
    bg: '#0F1117',
    surface: '#1A1D27',
    surfaceAlt: '#232734',
    border: '#2C3140',
    text: '#F2F4F8',
    textSecondary: '#9AA1B2',
    textMuted: '#6B7280',
    accent: '#F6C04D',
    accentText: '#1F1A08',
    accentSoft: 'rgba(246, 192, 77, 0.16)',
    red: '#F0524D',
    danger: '#EF4444',
    blue: '#5B8CFF',
    green: '#6FE0A0',
    tabBar: '#161922',
    statusBar: 'light-content',
  },
  light: {
    mode: 'light',
    bg: '#F7F8FA',
    surface: '#FFFFFF',
    surfaceAlt: '#F0F1F5',
    border: '#E5E7EB',
    text: '#171A22',
    textSecondary: '#60656F',
    textMuted: '#9AA0AD',
    accent: '#F3BB31',
    accentText: '#1F1A08',
    accentSoft: 'rgba(243, 187, 49, 0.18)',
    red: '#E54B45',
    danger: '#DC2626',
    blue: '#3B6FE0',
    green: '#0F9D58',
    tabBar: '#FFFFFF',
    statusBar: 'dark-content',
  },
};

type FontWeight = NonNullable<TextStyle['fontWeight']>;

export const weight = (w: 'regular' | 'medium' | 'semibold' | 'bold'): FontWeight =>
  ({ regular: '400', medium: '500', semibold: '600', bold: '700' })[w] as FontWeight;
