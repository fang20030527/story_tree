import type { VocabularyWord } from '@context-reader/contracts';

import { localReviewTime, mergeVocabularyWords, wordReviewLabel } from './wordPresentation';

const word: VocabularyWord = {
  wordId: 'word-1', term: 'bank', meaningZh: '银行', sourceSentence: null,
  contextCount: 2, reviewReason: 'new', nextReviewAt: '2026-09-14T12:30:00.000Z',
  practiceCount: 0, independentCorrectCount: 0, assistedCount: 0, lastPracticedAt: null,
};

it('explains new, failed and due words without claiming mastery', () => {
  expect(wordReviewLabel(word)).toBe('尚未练习');
  expect(wordReviewLabel({ ...word, reviewReason: 'relearn' })).toBe('需要再巩固');
  expect(wordReviewLabel({ ...word, reviewReason: 'due' })).toBe('到时间复习了');
});

it('shows explicit next review and recent practice times in the device timezone', () => {
  const localDate = new Date(2026, 8, 16, 7, 5).toISOString();
  expect(localReviewTime(localDate)).toBe('2026/09/16 07:05');
  expect(wordReviewLabel({ ...word, reviewReason: 'scheduled', nextReviewAt: localDate }))
    .toBe('下次复习 2026/09/16 07:05');
});

it('deduplicates repeated word IDs across pages without changing server order', () => {
  const refreshed = { ...word, independentCorrectCount: 1 };
  const second = { ...word, wordId: 'word-2', term: 'river' };
  expect(mergeVocabularyWords([word], [refreshed, second])).toEqual([refreshed, second]);
});
