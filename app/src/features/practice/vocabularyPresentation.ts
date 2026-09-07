import type {
  VocabularyItemDto,
  VocabularyStatus,
} from '@context-reader/contracts';

const statusLabels: Record<VocabularyStatus, string> = {
  pending: '待复习',
  reviewing: '复习中',
  mastered: '已掌握',
  self_reported: '用户自报已会',
};

export function vocabularyStatusLabel(status: VocabularyStatus): string {
  return statusLabels[status];
}

export function mergeVocabularyItems(
  current: VocabularyItemDto[],
  incoming: VocabularyItemDto[],
): VocabularyItemDto[] {
  const itemsById = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) itemsById.set(item.id, item);
  return [...itemsById.values()];
}
