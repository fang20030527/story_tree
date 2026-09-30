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
  pink: string;
  onPink: string;
  reviewPink: string;
  vip: string;
  onVip: string;
  statusBar: 'light-content' | 'dark-content';
}

export const themes: Record<ThemeMode, Theme> = {
  dark: {
    mode: 'dark',
    bg: '#191B17',
    surface: '#23261F',
    surfaceAlt: '#30342B',
    border: '#43483D',
    text: '#F4F2E6',
    textSecondary: '#CBCDC0',
    textMuted: '#ADB1A1',
    accent: '#F28F74',
    accentText: '#251B16',
    accentSoft: '#422D26',
    red: '#F28F74',
    danger: '#EF4444',
    blue: '#F28F74',
    green: '#6FE0A0',
    tabBar: '#191B17',
    pink: '#E59EB4',
    onPink: '#65303D',
    reviewPink: '#9E4464',
    vip: '#2A2D24',
    onVip: '#F4F2E6',
    statusBar: 'light-content',
  },
  light: {
    mode: 'light',
    bg: '#FBFAF6',
    surface: '#FFFCF7',
    surfaceAlt: '#EEEAE1',
    border: '#DDDCCF',
    text: '#252620',
    textSecondary: '#62675A',
    textMuted: '#6E7366',
    accent: '#B53720',
    accentText: '#FFFFFF',
    accentSoft: '#F7E8EB',
    red: '#D64727',
    danger: '#DC2626',
    blue: '#B53720',
    green: '#0F9D58',
    tabBar: '#FBFAF6',
    pink: '#E59EB4',
    onPink: '#65303D',
    reviewPink: '#A84966',
    vip: '#282C23',
    onVip: '#F4F2E6',
    statusBar: 'dark-content',
  },
};

export const fonts = { display: 'InstrumentSerif', reading: 'SourceSerif4' };

type FontWeight = NonNullable<TextStyle['fontWeight']>;

export const weight = (w: 'regular' | 'medium' | 'semibold' | 'bold'): FontWeight =>
  ({ regular: '400', medium: '500', semibold: '600', bold: '700' })[w] as FontWeight;
