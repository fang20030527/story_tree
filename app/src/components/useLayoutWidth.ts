import { useSyncExternalStore } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// 静态导出与首次水合使用相同断点；挂载后再采用浏览器的实际宽度。
export function useHydrationReady(): boolean {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return Platform.OS !== 'web' || hydrated;
}

export function useLayoutWidth(): number {
  const { width } = useWindowDimensions();
  const ready = useHydrationReady();
  return ready ? width : 0;
}
