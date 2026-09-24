import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { getEditorialArticle } from './catalog';
import { isEpubArticleId, prefetchEpubArticle } from './epubCatalog';
import {
  getRemoteEditorialDetail,
  isRemoteEditorialId,
  refreshRemoteEditorialDetail,
  useRemoteEditorialCatalogVersion,
} from './remoteCatalog';

export function useEditorialArticle(articleId: string) {
  useRemoteEditorialCatalogVersion();
  const remote = isRemoteEditorialId(articleId);
  const webEpub = Platform.OS === 'web' && isEpubArticleId(articleId);
  const needsLoading = remote || webEpub;
  const [requestState, setRequestState] = useState<{
    articleId: string;
    status: 'loading' | 'ready' | 'error';
  }>({ articleId, status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    if (!needsLoading) return;
    setRequestState({ articleId, status: 'loading' });
    setAttempt((current) => current + 1);
  }, [articleId, needsLoading]);

  useEffect(() => {
    if (!needsLoading) return;
    let active = true;
    void (remote ? refreshRemoteEditorialDetail(articleId) : prefetchEpubArticle(articleId))
      .then(() => { if (active) setRequestState({ articleId, status: 'ready' }); })
      .catch(() => { if (active) setRequestState({ articleId, status: 'error' }); });
    return () => { active = false; };
  }, [articleId, remote, needsLoading, attempt]);

  const status = requestState.articleId === articleId ? requestState.status : 'loading';
  const article = (remote && !getRemoteEditorialDetail(articleId)) || (webEpub && status !== 'ready')
    ? undefined
    : getEditorialArticle(articleId);
  return { article, loading: needsLoading && !article && status === 'loading',
    error: needsLoading && !article && status === 'error', retry };
}
