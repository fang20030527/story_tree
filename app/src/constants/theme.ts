import { Easing, type TextStyle } from 'react-native';

export type ThemeMode = 'light' | 'dark';

/** 插画与星体用色。图形里不放文字，所以可以直接用 logo 原色。 */
export interface GraphicPalette {
  vermilion: string;
  pink: string;
  /** 吸积盘最内侧、光子环的暖白。 */
  hot: string;
  /** 黑洞视界。 */
  hole: string;
  /** 轨道虚线、未点亮的星、新月暗面。 */
  track: string;
  /** 声环星正面刻度。 */
  rose: string;
  roseShade: string;
  /** 朱橙星体的背光面。 */
  shade: string;
  cream: string;
  creamStrong: string;
  /** 漂流瓶玻璃。 */
  glass: string;
  /** 空状态里安静的黑洞、声环星。 */
  quiet1: string;
  quiet2: string;
  /** 吸积盘流动纹理。 */
  flowIn: string;
  flowOut: string;
  star: string;
}

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
  /** 豆沙玫瑰：口语模式的强调色，纸面上 4.97:1，可以承载文字和图标。 */
  rose: string;
  roseSoft: string;
  /** 深空：插画、VIP 卡底色，两种主题下都是暗的。 */
  space: string;
  onSpace: string;
  onSpaceMuted: string;
  /** 正文里已收藏生词的底色。 */
  marker: string;
  onMarker: string;
  success: string;
  danger: string;
  heat: readonly [string, string, string, string, string];
  tabBar: string;
  statusBar: 'light-content' | 'dark-content';
  graphic: GraphicPalette;
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
    rose: '#B4466C',
    roseSoft: '#F9E4EB',
    space: '#1E1418',
    onSpace: '#FFF4EA',
    onSpaceMuted: 'rgba(255, 244, 234, 0.76)',
    marker: '#F7D5DF',
    onMarker: '#22171A',
    success: '#2F7D5B',
    danger: '#A3261F',
    heat: ['#F1E6E5', '#F7D5DF', '#E59EB4', '#D64727', '#8E2A16'],
    tabBar: '#FFFFFF',
    statusBar: 'dark-content',
    graphic: {
      vermilion: '#D64727', pink: '#E59EB4', hot: '#F7B69A', hole: '#22171A', track: '#E3D5D4',
      rose: '#C2577D', roseShade: '#C97B95', shade: '#A9351C', cream: '#FFE9DC', creamStrong: '#FFF3EA',
      glass: '#F5D3DE', quiet1: '#F3D3DD', quiet2: '#E9B0C2',
      flowIn: 'rgba(255, 236, 224, 0.5)', flowOut: 'rgba(255, 255, 255, 0.42)', star: '#FFF4EA',
    },
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
    rose: '#F2A7C0',
    roseSoft: '#3A2129',
    space: '#1E1418',
    onSpace: '#FFF4EA',
    onSpaceMuted: 'rgba(255, 244, 234, 0.76)',
    marker: '#4A2533',
    onMarker: '#F8CCDA',
    success: '#6FCB95',
    danger: '#F08A7E',
    heat: ['#2A1F22', '#4A2533', '#8C4A60', '#E59EB4', '#F2714F'],
    tabBar: '#1A1215',
    statusBar: 'light-content',
    graphic: {
      vermilion: '#E8583A', pink: '#E59EB4', hot: '#FFD9C6', hole: '#0A0607', track: '#3D2E33',
      rose: '#E58AA9', roseShade: '#B5647F', shade: '#B23D20', cream: '#FFE9DC', creamStrong: '#FFE9DC',
      glass: '#5A3443', quiet1: '#3B2430', quiet2: '#5A3443',
      flowIn: 'rgba(255, 236, 224, 0.42)', flowOut: 'rgba(255, 255, 255, 0.3)', star: '#FFF4EA',
    },
  },
};

/** 深空面板上的图形：无论浅色还是深色主题，底都是暗的。 */
export const spaceGraphic: GraphicPalette = { ...themes.dark.graphic, track: 'rgba(255, 244, 234, 0.22)' };

/**
 * 只用两种字体：系统字体负责中文、界面和小号数字；Literata 负责英文内容和大号数字。
 * label 为 undefined 即系统字体。reading* 的字重已在字体文件里，不要再叠加 fontWeight，Web 会二次加粗。
 */
export const fonts = {
  /** 大号数字与英文展示字：Literata SemiBold，配合 fontVariant tabular-nums。 */
  display: 'HeidongReadingSemiBold',
  label: undefined as string | undefined,
  reading: 'HeidongReading',
  readingMedium: 'HeidongReadingMedium',
  readingSemibold: 'HeidongReadingSemiBold',
};

/** 能点的是胶囊；内容容器按大小用三档圆角：卡片 20、图片和内容块 12、标签 8。 */
export const radius = { pill: 999, option: 14, content: 12, card: 20, tag: 8, sheet: 26 };

/** 页面左右留白、模块间距。 */
export const space = { page: 20, section: 30 };

/** logo 椭圆的倾斜角度，所有轨道图形共用。 */
export const orbitTilt = '20deg';

/**
 * 动效令牌：界面反馈 100–240ms，图形入场 400–700ms，环境循环 3 秒以上；离开比进入快。
 * 与提案原型中的 CSS 曲线一致。
 */
export const motion = {
  press: 100,
  quick: 160,
  base: 240,
  leave: 200,
  gentle: 360,
  draw: 700,
  easeOut: Easing.bezier(0.2, 0.8, 0.2, 1),
  easeIn: Easing.bezier(0.4, 0, 1, 1),
  easeInOut: Easing.bezier(0.45, 0, 0.2, 1),
};

type FontWeight = NonNullable<TextStyle['fontWeight']>;

export const weight = (w: 'regular' | 'medium' | 'semibold' | 'bold'): FontWeight =>
  ({ regular: '400', medium: '500', semibold: '600', bold: '700' })[w] as FontWeight;

/** 字号表：只用常规、中等、中粗三档。 */
export const typeScale = {
  pageTitle: { fontSize: 27, lineHeight: 36, fontWeight: weight('semibold') },
  section: { fontSize: 19, lineHeight: 26, fontWeight: weight('semibold') },
  cardTitle: { fontSize: 15.5, lineHeight: 22, fontWeight: weight('medium') },
  body: { fontSize: 15, lineHeight: 24 },
  meta: { fontSize: 12.5, lineHeight: 18 },
  number: { fontFamily: 'HeidongReadingSemiBold', fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
} satisfies Record<string, TextStyle>;
