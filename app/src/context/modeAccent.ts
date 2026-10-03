import * as LearningModeModule from '@/context/LearningModeContext';
import type { LearningMode } from '@/context/LearningModeContext';
import { useAppTheme } from '@/context/ThemeContext';
import type { Theme } from '@/constants/theme';

/** 模式色只用于识别元素：导航选中、模式胶囊、进度、当前句、录音键。主按钮两种模式都是朱橙。 */
export interface ModeAccent {
  mode: LearningMode;
  /** 文字、图标、进度：阅读朱橙·深，口语豆沙玫瑰。 */
  ink: string;
  /** 浅底：选中的胶囊、当前句。 */
  soft: string;
  /** 大面积图形：阅读朱橙，口语豆沙粉。 */
  graphic: string;
}

export function modeAccent(theme: Theme, mode: LearningMode): ModeAccent {
  return mode === 'speak'
    ? { mode, ink: theme.rose, soft: theme.roseSoft, graphic: theme.pink }
    : { mode, ink: theme.accent, soft: theme.accentSoft, graphic: theme.vermilion };
}

/** 测试里常只模拟 useLearningMode，这里优先用不抛错的版本，缺失时退回原钩子。 */
const useModeValue = LearningModeModule.useOptionalLearningMode ?? LearningModeModule.useLearningMode;

/** 读取学习模式；没有 Provider 时按阅读模式处理。 */
export function useModeState() {
  return useModeValue();
}

export function useModeAccent(): ModeAccent {
  const { mode } = useModeValue();
  const { theme } = useAppTheme();
  return modeAccent(theme, mode);
}
