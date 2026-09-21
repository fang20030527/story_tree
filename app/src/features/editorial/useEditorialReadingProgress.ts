import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { loadEditorialReadingProgress, saveEditorialReadingProgress } from './editorialReadingProgress';

export function useEditorialReadingProgress(articleId: string) {
  const scrollRef = useRef<ScrollView>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedWords, setAddedWords] = useState<ReadonlySet<string>>(new Set());
  const [showFullTranslation, setShowFullTranslation] = useState(false);
  const position = useRef({ scrollY: 0, showFullTranslation: false });
  const dirty = useRef(false);
  const restored = useRef(false);
  const dimensions = useRef({ height: 0, contentHeight: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    void saveEditorialReadingProgress(articleId, { ...position.current }).then(() => {
      if (mounted.current) setError(null);
    }).catch(() => {
      dirty.current = true;
      if (mounted.current) setError('阅读进度保存失败，请重试');
    });
  }, [articleId]);

  const load = useCallback(() => loadEditorialReadingProgress(articleId).then((saved) => {
    if (!mounted.current) return;
    position.current = { scrollY: saved.scrollY, showFullTranslation: saved.showFullTranslation };
    setAddedWords(new Set(saved.addedWords));
    setShowFullTranslation(saved.showFullTranslation);
    setError(null);
    setLoaded(true);
  }).catch(() => {
    if (mounted.current) setError('阅读进度读取失败，请重试');
  }), [articleId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      flush();
    };
  }, [load, flush]);

  const restore = () => {
    const { height, contentHeight } = dimensions.current;
    if (!loaded || restored.current || !height || !contentHeight || !scrollRef.current) return;
    restored.current = true;
    scrollRef.current.scrollTo({ y: Math.min(position.current.scrollY, Math.max(0, contentHeight - height)), animated: false });
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!restored.current) return;
    const y = Math.max(0, event.nativeEvent.contentOffset.y);
    if (!Number.isFinite(y) || y === position.current.scrollY) return;
    position.current.scrollY = y;
    dirty.current = true;
    // 持续滚动时也定期落盘；退出和切后台时立即保存最后位置。
    if (!timer.current) timer.current = setTimeout(flush, 300);
  };

  const retry = useCallback(() => {
    if (loaded) flush(); else void load();
  }, [loaded, flush, load]);

  const toggleTranslation = useCallback(() => {
    position.current.showFullTranslation = !position.current.showFullTranslation;
    setShowFullTranslation(position.current.showFullTranslation);
    dirty.current = true;
    flush();
  }, [flush]);

  return {
    loaded, error, addedWords, showFullTranslation, scrollRef, onScroll, flush,
    retry, toggleTranslation,
    onLayout: (height: number) => { dimensions.current.height = height; restore(); },
    onContentSizeChange: (height: number) => { dimensions.current.contentHeight = height; restore(); },
    wordAdded: (term: string) => {
      setAddedWords((current) => new Set([...current, term.trim().toLocaleLowerCase('en-US')]));
    },
  };
}
