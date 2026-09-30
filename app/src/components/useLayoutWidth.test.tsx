/** @jest-environment jsdom */
import React, { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server.node';

import { useHydrationReady, useLayoutWidth } from './useLayoutWidth';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  useWindowDimensions: () => ({ width: 1440, height: 960 }),
}));

beforeAll(() => {
  // 此测试只验证 DOM 水合，避免 jsdom 清理时触发 Expo 的原生 fetch 懒加载。
  globalThis.fetch = jest.fn();
});

function Layout() {
  const wide = useLayoutWidth() >= 768;
  return <div>{wide ? <aside>侧边导航</aside> : <nav>底部导航</nav>}</div>;
}

it('水合期间保持静态布局，挂载后使用宽屏导航且不产生水合错误', async () => {
  const html = renderToString(<Layout />);
  expect(html).toContain('底部导航');
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <Layout />, {
      onRecoverableError: error => errors.push(error),
    });
  });
  expect(errors).toEqual([]);
  expect(container.querySelector('aside')?.textContent).toBe('侧边导航');
  await act(async () => root.unmount());
  container.remove();
});

it('静态导出与访问日期不同时，挂载后显示当前日期且没有水合错误', async () => {
  function DatedLog({ date }: { date: string }) {
    const ready = useHydrationReady();
    return <div>{ready ? date : '学习日志'}</div>;
  }
  const container = document.createElement('div');
  container.innerHTML = renderToString(<DatedLog date="2026-09-30" />);
  expect(container.textContent).toBe('学习日志');
  document.body.appendChild(container);
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <DatedLog date="2026-10-01" />, {
      onRecoverableError: error => errors.push(error),
    });
  });
  expect(errors).toEqual([]);
  expect(container.textContent).toBe('2026-10-01');
  await act(async () => root.unmount());
  container.remove();
});
