import type { VocabularyItemDto } from '@context-reader/contracts';

import {
  mergeVocabularyItems,
  vocabularyStatusLabel,
} from './vocabularyPresentation';

function item(id: string, term: string): VocabularyItemDto {
  return {
    id,
    term,
    meaningZh: '义项',
    sourceSentence: null,
    status: 'pending',
    practiceCount: 0,
    firstTryCorrectCount: 0,
    assistedCount: 0,
    lastPracticedAt: null,
  };
}

describe('vocabularyStatusLabel', () => {
  it('maps every durable vocabulary status to its Chinese label', () => {
    expect(vocabularyStatusLabel('pending')).toBe('待复习');
    expect(vocabularyStatusLabel('reviewing')).toBe('复习中');
    expect(vocabularyStatusLabel('mastered')).toBe('已掌握');
    expect(vocabularyStatusLabel('self_reported')).toBe('用户自报已会');
  });

  it('appends cursor pages without duplicating an item', () => {
    const first = item('11111111-1111-4111-8111-111111111111', 'resilient');
    const refreshed = { ...first, practiceCount: 1 };
    const second = item('22222222-2222-4222-8222-222222222222', 'ambiguous');

    expect(mergeVocabularyItems([first], [refreshed, second])).toEqual([
      refreshed,
      second,
    ]);
  });
});
