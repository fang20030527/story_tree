import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { VocabularyWordPage } from '@context-reader/contracts';

import { getVocabularyWords } from '@/api/practices';
import { useSavedVocabularyWords } from './useSavedVocabularyWords';

jest.mock('@/api/practices', () => ({ getVocabularyWords: jest.fn() }));

function page(terms: string[], nextCursor: string | null = null): VocabularyWordPage {
  return {
    items: terms.map((term) => ({
      wordId: '11111111-1111-4111-8111-111111111111', term, meaningZh: '词义', sourceSentence: null,
      contextCount: 1, reviewReason: 'new', nextReviewAt: '2026-09-22T00:00:00Z',
      practiceCount: 0, independentCorrectCount: 0, assistedCount: 0, lastPracticedAt: null, masteredAt: null,
    })),
    nextCursor, evaluatedAt: '2026-09-22T00:00:00Z', nextRefreshAt: null,
    summary: { totalCount: terms.length, todayCount: 0, learningCount: 0, dueLearningCount: 0, unlearnedCount: terms.length, masteredCount: 0 },
  };
}

beforeEach(() => jest.resetAllMocks());

it('restores persisted words on every reopening and loads all pages with normalized terms', async () => {
  jest.mocked(getVocabularyWords).mockResolvedValueOnce(page([' Reader '], 'next')).mockResolvedValue(page(['studies']));
  const first = await renderHook(() => useSavedVocabularyWords('article'));
  await waitFor(() => expect([...first.result.current.addedWords]).toEqual(['reader', 'studies']));
  expect(getVocabularyWords).toHaveBeenNthCalledWith(2, { filter: 'all', limit: 50, cursor: 'next' });
  await first.unmount();
  jest.mocked(getVocabularyWords).mockResolvedValue(page(['reader', 'studies']));
  const reopened = await renderHook(() => useSavedVocabularyWords('article'));
  await waitFor(() => expect(reopened.result.current.addedWords.has('reader')).toBe(true));
});

it('keeps newly added highlights when an older request finishes', async () => {
  let resolve!: (value: VocabularyWordPage) => void;
  jest.mocked(getVocabularyWords).mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = await renderHook(() => useSavedVocabularyWords('article'));
  await act(async () => view.result.current.handleWordAdded(' New '));
  await act(async () => resolve(page(['old'])));
  expect([...view.result.current.addedWords]).toEqual(['new', 'old']);
});

it('ignores old article responses after switching articles', async () => {
  let resolve!: (value: VocabularyWordPage) => void;
  jest.mocked(getVocabularyWords).mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValue(page(['second']));
  const view = await renderHook<ReturnType<typeof useSavedVocabularyWords>, { id: string }>(
    ({ id }) => useSavedVocabularyWords(id), { initialProps: { id: 'first' } },
  );
  await view.rerender({ id: 'second' });
  await waitFor(() => expect(view.result.current.addedWords.has('second')).toBe(true));
  await act(async () => resolve(page(['stale'])));
  expect([...view.result.current.addedWords]).toEqual(['second']);
});

it('retains loaded highlights on pagination failure and restores remaining words on retry', async () => {
  jest.mocked(getVocabularyWords).mockResolvedValueOnce(page(['reader'], 'next')).mockRejectedValueOnce(new Error('offline'));
  const view = await renderHook(() => useSavedVocabularyWords('article'));
  await waitFor(() => expect(view.result.current.error).toBe(true));
  expect(view.result.current.addedWords.has('reader')).toBe(true);
  jest.mocked(getVocabularyWords).mockResolvedValue(page(['reader', 'studies']));
  await act(async () => view.result.current.retry());
  await waitFor(() => expect(view.result.current.addedWords.has('studies')).toBe(true));
  expect(view.result.current.error).toBe(false);
});
