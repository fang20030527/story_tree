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
  /** 朱橙·深：按钮、链接等可点击元素。logo 朱橙降 3% 亮度，白字对比度 5.05:1。 */
  accent: string;
  accentText: string;
  accentSoft: string;
  /** logo 朱橙原色：导航标记、轨道、进度等图形，不承载正文文字。 */
  vermilion: string;
  /** logo 豆沙粉：单词标签、书脊、会员；上面只放 onPink 文字，不放白字。 */
  pink: string;
  onPink: string;
  /** 正文里已收藏生词的底色。 */
  marker: string;
  onMarker: string;
  success: string;
  danger: string;
  heat: readonly [string, string, string, string, string];
  tabBar: string;
  statusBar: 'light-content' | 'dark-content';
}

export const themes: Record<ThemeMode, Theme> = {
  light: {
    mode: 'light',
    bg: '#FCF9F8',
    surface: '#FFFFFF',
    surfaceAlt: '#F4EBEB',
    border: '#EBDFE0',
    text: '#22171A',
    textSecondary: '#5F5054',
    textMuted: '#7D6D71',
    accent: '#C54124',
    accentText: '#FFFFFF',
    accentSoft: '#FBE6E0',
    vermilion: '#D64727',
    pink: '#E59EB4',
    onPink: '#22171A',
    marker: '#F7D5DF',
    onMarker: '#22171A',
    success: '#2F7D5B',
    danger: '#A3261F',
    heat: ['#F4EBEB', '#F7D5DF', '#E59EB4', '#D64727', '#7E2414'],
    tabBar: '#FCF9F8',
    statusBar: 'dark-content',
  },
  dark: {
    mode: 'dark',
    bg: '#150E10',
    surface: '#1E1518',
    surfaceAlt: '#2A1F22',
    border: '#3A2C30',
    text: '#F5ECEB',
    textSecondary: '#CDBEC0',
    textMuted: '#A8979B',
    accent: '#F2714F',
    accentText: '#1A1012',
    accentSoft: '#3A1F1A',
    vermilion: '#F2714F',
    pink: '#E59EB4',
    onPink: '#22171A',
    marker: '#4A2533',
    onMarker: '#F8CCDA',
    success: '#6FCB95',
    danger: '#F08A7E',
    heat: ['#2A1F22', '#4A2533', '#8C4A60', '#E59EB4', '#F2714F'],
    tabBar: '#150E10',
    statusBar: 'light-content',
  },
};

/** display/label 只含拉丁字符，中文自动回落系统黑体；字重已在字体文件里，不要再叠加 fontWeight，Web 会二次加粗。 */
export const fonts = {
  display: 'HeidongBrand',
  label: 'HeidongBrandSemiBold',
  reading: 'HeidongReading',
  readingMedium: 'HeidongReadingMedium',
  readingSemibold: 'HeidongReadingSemiBold',
};

/** 能点的是圆的（pill/option），内容是方的（content）。 */
export const radius = { pill: 999, option: 14, content: 2, sheet: 22 };

/** logo 椭圆的倾斜角度，所有轨道图形共用。 */
export const orbitTilt = '20deg';

type FontWeight = NonNullable<TextStyle['fontWeight']>;

export const weight = (w: 'regular' | 'medium' | 'semibold' | 'bold'): FontWeight =>
  ({ regular: '400', medium: '500', semibold: '600', bold: '700' })[w] as FontWeight;
