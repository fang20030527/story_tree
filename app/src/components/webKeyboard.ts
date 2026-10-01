import type { KeyboardEvent } from 'react';
import { Platform } from 'react-native';

// React Native Web 支持 DOM 键盘事件，原生端继续使用 accessibilityActions。
export function webKeyboard(handler: (event: KeyboardEvent) => void) {
  return Platform.OS === 'web' ? { onKeyDown: handler } : {};
}
