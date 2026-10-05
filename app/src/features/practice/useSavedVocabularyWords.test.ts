import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { VocabularyTerms } from '@context-reader/contracts';

import { getVocabularyTerms } from '@/api/practices';
import { useSavedVocabularyWords } from './useSavedVocabularyWords';

jest.mock('@/api/practices', () => ({ getVocabularyTerms: jest.fn() }));

const terms = (...values: string[]): VocabularyTerms => ({ terms: values });

beforeEach(() => jest.resetAllMocks());

it('restores persisted words on every reopening with one request and normalized terms', async () => {
  jest.mocked(getVocabularyTerms).mockResolvedValue(terms(' Reader ', 'studies'));
  const first = await renderHook(() => useSavedVocabularyWords('article'));
  await waitFor(() => expect([...first.result.current.addedWords]).toEqual(['reader', 'studies']));
  expect(getVocabularyTerms).toHaveBeenCalledTimes(1);
  await first.unmount();
  const reopened = await renderHook(() => useSavedVocabularyWords('article'));
  await waitFor(() => expect(reopened.result.current.addedWords.has('reader')).toBe(true));
});

it('keeps newly added highlights when an older request finishes', async () => {
  let resolve!: (value: VocabularyTerms) => void;
  jest.mocked(getVocabularyTerms).mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = await renderHook(() => useSavedVocabularyWords('article'));
  await act(async () => view.result.current.handleWordAdded(' New '));
  await act(async () => resolve(terms('old')));
  expect([...view.result.current.addedWords]).toEqual(['new', 'old']);
});

it('ignores old article responses after switching articles', async () => {
  let resolve!: (value: VocabularyTerms) => void;
  jest.mocked(getVocabularyTerms).mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValue(terms('second'));
  const view = await renderHook<ReturnType<typeof useSavedVocabularyWords>, { id: string }>(
    ({ id }) => useSavedVocabularyWords(id), { initialProps: { id: 'first' } },
  );
  await view.rerender({ id: 'second' });
  await waitFor(() => expect(view.result.current.addedWords.has('second')).toBe(true));
  await act(async () => resolve(terms('stale')));
  expect([...view.result.current.addedWords]).toEqual(['second']);
});

it('reports a failed load and restores the words on retry', async () => {
  jest.mocked(getVocabularyTerms).mockRejectedValueOnce(new Error('offline'));
  const view = await renderHook(() => useSavedVocabularyWords('article'));
  await waitFor(() => expect(view.result.current.error).toBe(true));
  jest.mocked(getVocabularyTerms).mockResolvedValue(terms('reader', 'studies'));
  await act(async () => view.result.current.retry());
  await waitFor(() => expect(view.result.current.addedWords.has('studies')).toBe(true));
  expect(view.result.current.error).toBe(false);
});
