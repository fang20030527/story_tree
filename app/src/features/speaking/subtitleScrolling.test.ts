/** @jest-environment jsdom */
import { Platform, type ScrollView } from 'react-native';
import { scrollToRenderedSubtitle } from './subtitleScrolling';

afterEach(() => { jest.restoreAllMocks(); document.body.replaceChildren(); });

function transcript({ top, height, scrollTop, cueTop, cueHeight }: { top: number; height: number; scrollTop: number; cueTop: number; cueHeight: number }) {
  const viewport = document.createElement('div');
  const cue = document.createElement('div'); cue.id = 'shadowing-cue-258';
  viewport.append(cue); document.body.append(viewport); viewport.scrollTop = scrollTop;
  Object.defineProperty(viewport, 'clientHeight', { value: height });
  jest.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top, height } as DOMRect);
  jest.spyOn(cue, 'getBoundingClientRect').mockReturnValue({ top: cueTop, height: cueHeight } as DOMRect);
  const scrollTo = jest.fn();
  const list = { getNativeScrollRef: () => viewport, scrollTo } as unknown as ScrollView;
  return { list, scrollTo };
}

it('positions a late-film cue after a portrait resize without relying on old row heights', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const { list, scrollTo } = transcript({ top: 526, height: 154, scrollTop: 0, cueTop: 37678, cueHeight: 134 });
  expect(scrollToRenderedSubtitle(list, 'shadowing-cue-258', 0)).toBe(true);
  expect(scrollTo).toHaveBeenCalledWith({ y: 37152, animated: false });
});

it('preserves the desktop reading position when the transcript is already scrolled', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const { list, scrollTo } = transcript({ top: 80, height: 500, scrollTop: 123, cueTop: 180, cueHeight: 100 });
  expect(scrollToRenderedSubtitle(list, 'shadowing-cue-258', .3)).toBe(true);
  expect(scrollTo).toHaveBeenCalledWith({ y: 103, animated: false });
});

it('leaves native and unrendered cues to the regular list scrolling path', () => {
  const { list, scrollTo } = transcript({ top: 0, height: 500, scrollTop: 0, cueTop: 0, cueHeight: 100 });
  jest.replaceProperty(Platform, 'OS', 'ios');
  expect(scrollToRenderedSubtitle(list, 'shadowing-cue-258', 0)).toBe(false);
  jest.replaceProperty(Platform, 'OS', 'web');
  expect(scrollToRenderedSubtitle(list, 'shadowing-cue-999', 0)).toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();
});
