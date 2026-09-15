import type { VocabularyWord } from '@context-reader/contracts';

/** Display server UTC timestamps in the device's local timezone. */
export function localReviewTime(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function wordReviewLabel(word: VocabularyWord): string {
  switch (word.reviewReason) {
    case 'new': return '尚未练习';
    case 'relearn': return '需要再巩固';
    case 'due': return '到时间复习了';
    case 'scheduled': return `下次复习 ${localReviewTime(word.nextReviewAt)}`;
  }
}

/** Pagination is already grouped on the server; protect against repeated IDs. */
export function mergeVocabularyWords(
  current: VocabularyWord[],
  incoming: VocabularyWord[],
): VocabularyWord[] {
  const byId = new Map(current.map((word) => [word.wordId, word]));
  incoming.forEach((word) => byId.set(word.wordId, word));
  return [...byId.values()];
}
