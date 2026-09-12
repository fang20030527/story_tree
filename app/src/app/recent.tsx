import React from 'react';

import { LibraryListScreen } from '@/features/library/LibraryListScreen';
import {
  clearRecentViews,
  loadRecentViews,
  removeRecentView,
} from '@/features/library/libraryStorage';

export default function RecentScreen() {
  return (
    <LibraryListScreen
      title="最近观看"
      load={loadRecentViews}
      emptyIcon="time-outline"
      emptyText="还没有阅读记录"
      onRemove={removeRecentView}
      removeLabel="删除这条记录"
      onClearAll={clearRecentViews}
      clearLabel="清空"
      clearConfirmTitle="清空最近观看"
      clearConfirmMessage="确定要清空全部最近观看记录吗？"
    />
  );
}
