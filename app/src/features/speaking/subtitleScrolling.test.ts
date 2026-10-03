/** @jest-environment jsdom */
import { Platform, type ScrollView } from 'react-native';
import { observeRenderedSubtitles, scrollToRenderedSubtitle } from './subtitleScrolling';

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

it('reports only intersecting Web rows and disconnects when the transcript changes', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const { list } = transcript({ top: 80, height: 500, scrollTop: 0, cueTop: 100, cueHeight: 100 });
  const viewport = list.getNativeScrollRef() as unknown as HTMLElement;
  const first = viewport.firstElementChild!;
  const second = document.createElement('div'); second.id = 'shadowing-cue-259'; viewport.append(second);
  let changed!: IntersectionObserverCallback;
  const observe = jest.fn(); const disconnect = jest.fn();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  const observer = { observe, disconnect } as unknown as IntersectionObserver;
  const create = jest.fn((callback: IntersectionObserverCallback) => { changed = callback; return observer; });
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: create });
  try {
    const onVisible = jest.fn();
    const close = observeRenderedSubtitles(list, onVisible);
    expect(create).toHaveBeenCalledWith(expect.any(Function), { root: viewport });
    expect(observe).toHaveBeenCalledTimes(2);
    changed([{ target: first, isIntersecting: true }, { target: second, isIntersecting: false }] as IntersectionObserverEntry[], observer);
    expect(onVisible).toHaveBeenLastCalledWith([258]);
    changed([{ target: first, isIntersecting: false }, { target: second, isIntersecting: true }] as IntersectionObserverEntry[], observer);
    expect(onVisible).toHaveBeenLastCalledWith([259]);
    close?.();
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'IntersectionObserver', original);
    else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  }
});
