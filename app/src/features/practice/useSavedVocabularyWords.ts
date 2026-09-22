import { useCallback, useEffect, useState } from 'react';

import { getVocabularyWords } from '@/api/practices';

const EMPTY_WORDS: ReadonlySet<string> = new Set();
const normalize = (term: string) => term.trim().toLocaleLowerCase('en-US');

/** 从生词本恢复高亮，包括修复前已保存的词；不依赖段落组件的生命周期。 */
export function useSavedVocabularyWords(readerId: string | undefined) {
  const [state, setState] = useState<{
    readerId: string | undefined;
    words: ReadonlySet<string>;
    error: boolean;
  }>({ readerId, words: EMPTY_WORDS, error: false });
  const [attempt, setAttempt] = useState(0);
  if (state.readerId !== readerId) {
    setState({ readerId, words: EMPTY_WORDS, error: false });
  }

  useEffect(() => {
    let active = true;
    if (!readerId) return;

    const load = async () => {
      let cursor: string | undefined;
      try {
        do {
          const page = await getVocabularyWords({ filter: 'all', limit: 50, ...(cursor ? { cursor } : {}) });
          if (!active) return;
          // 合并加载期间刚加入的词，避免慢响应覆盖即时高亮。
          setState((current) => current.readerId !== readerId ? current : {
            ...current,
            words: new Set([...current.words, ...page.items.map((item) => normalize(item.term)).filter(Boolean)]),
          });
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      } catch {
        if (active) setState((current) => current.readerId !== readerId ? current : { ...current, error: true });
      }
    };
    void load();
    return () => { active = false; };
  }, [readerId, attempt]);

  const handleWordAdded = useCallback((term: string) => {
    const word = normalize(term);
    if (!word) return;
    setState((current) => current.readerId !== readerId ? current : {
      ...current, words: new Set([...current.words, word]),
    });
  }, [readerId]);
  const retry = useCallback(() => {
    setState((current) => ({ ...current, error: false }));
    setAttempt((current) => current + 1);
  }, []);

  return {
    addedWords: state.readerId === readerId ? state.words : EMPTY_WORDS,
    error: state.readerId === readerId && state.error,
    handleWordAdded,
    retry,
  };
}
