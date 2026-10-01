import { Platform, type ScrollView } from 'react-native';

// 按 Web 字幕的实际位置定位，适配换行和离屏内容重新布局。
export function scrollToRenderedSubtitle(list: ScrollView, nativeId: string, viewPosition: number) {
  if (Platform.OS !== 'web') return false;
  const viewport = list.getNativeScrollRef() as unknown as HTMLElement | null;
  if (!viewport || typeof viewport.querySelector !== 'function') return false;
  const row = viewport.querySelector(`#${nativeId}`);
  if (!row || viewport.clientHeight <= 0) return false;
  const bounds = row.getBoundingClientRect();
  if (bounds.height <= 0) return false;
  const offset = viewport.scrollTop + bounds.top - viewport.getBoundingClientRect().top
    - (viewport.clientHeight - bounds.height) * viewPosition;
  list.scrollTo({ y: Math.max(0, offset), animated: false });
  return true;
}
