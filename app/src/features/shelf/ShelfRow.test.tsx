import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { getEditorialArticle } from '@/features/editorial/catalog';

import { ShelfRow } from './ShelfRow';
import type { ShelfItem } from './shelfModel';

jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

const editorialItem: ShelfItem = {
  kind: 'editorial',
  id: 'hero',
  timestamp: '2026-09-12T09:00:00.000Z',
  article: getEditorialArticle('hero')!,
};
const importedItem: ShelfItem = {
  kind: 'imported',
  id: '11111111-1111-4111-8111-111111111111',
  timestamp: '2026-09-11T08:00:00.000Z',
  article: {
    id: '11111111-1111-4111-8111-111111111111',
    sourceKind: 'paste', sourceUrl: null, title: 'Private article',
    wordCount: 800, importedAt: '2026-09-11T08:00:00.000Z',
  },
};

it.each([
  [editorialItem, '移出书架', 'BBC Future', '拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母'],
  [importedItem, '删除文章', '粘贴正文', 'Private article'],
] as const)('renders and dispatches the %s row', async (item, action, meta, title) => {
  const onOpen = jest.fn();
  const onManage = jest.fn();
  const view = await render(
    <ShelfRow
      item={item}
      managing
      deleting={false}
      onOpen={onOpen}
      onManage={onManage}
    />,
  );
  expect(view.getByText(meta)).toBeTruthy();
  await fireEvent.press(view.getByText(title));
  expect(onOpen).toHaveBeenCalledWith(item);
  expect(onManage).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText(action));
  expect(onManage).toHaveBeenCalledWith(item);
});

it('shows an imported article image and falls back if it cannot load', async () => {
  const item: ShelfItem = {
    ...importedItem,
    article: {
      ...importedItem.article,
      coverImageUrl: 'https://images.example.com/article.jpg',
    },
  };
  const view = await render(<ShelfRow
    item={item} managing={false} deleting={false}
    onOpen={jest.fn()} onManage={jest.fn()}
  />);
  expect(view.getByTestId('imported-cover-image').props.source).toContainEqual({
    uri: 'https://images.example.com/article.jpg',
  });
  await fireEvent(view.getByTestId('imported-cover-image'), 'error', { nativeEvent: {} });
  expect(view.getByTestId('imported-cover-placeholder')).toBeTruthy();
});

it('uses the document placeholder when an imported article has no image', async () => {
  const view = await render(<ShelfRow
    item={importedItem} managing={false} deleting={false}
    onOpen={jest.fn()} onManage={jest.fn()}
  />);
  expect(view.getByTestId('imported-cover-placeholder')).toBeTruthy();
});

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
