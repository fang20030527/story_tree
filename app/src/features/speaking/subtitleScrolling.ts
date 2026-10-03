import { Platform, type ScrollView } from 'react-native';

/** 观察实际可见的 Web 字幕，不随播放计时遍历整片字幕的位置。 */
export function observeRenderedSubtitles(list: ScrollView, onVisible: (indexes: number[]) => void) {
  if (Platform.OS !== 'web' || typeof IntersectionObserver === 'undefined') return;
  const viewport = list.getNativeScrollRef() as unknown as HTMLElement | null;
  if (!viewport || typeof viewport.querySelectorAll !== 'function') return;
  const visible = new Set<number>();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const index = Number(entry.target.id.replace('shadowing-cue-', ''));
      if (!Number.isSafeInteger(index) || index < 0) continue;
      if (entry.isIntersecting) visible.add(index); else visible.delete(index);
    }
    onVisible([...visible]);
  }, { root: viewport });
  viewport.querySelectorAll('[id^="shadowing-cue-"]').forEach(row => observer.observe(row));
  return () => observer.disconnect();
}

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
