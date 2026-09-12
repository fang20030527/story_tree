import React from 'react';

import { LibraryListScreen } from '@/features/library/LibraryListScreen';
import {
  loadFavorites,
  removeFavorite,
} from '@/features/library/libraryStorage';

export default function FavoritesScreen() {
  return (
    <LibraryListScreen
      title="我的收藏"
      load={loadFavorites}
      emptyIcon="star-outline"
      emptyText="还没有收藏的文章"
      onRemove={removeFavorite}
      removeLabel="取消收藏"
    />
  );
}
