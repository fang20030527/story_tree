import { useCallback, useEffect, useState } from 'react';

import { getEditorialArticle } from './catalog';
import {
  getRemoteEditorialDetail,
  isRemoteEditorialId,
  refreshRemoteEditorialDetail,
  useRemoteEditorialCatalogVersion,
} from './remoteCatalog';

export function useEditorialArticle(articleId: string) {
  useRemoteEditorialCatalogVersion();
  const remote = isRemoteEditorialId(articleId);
  const [requestState, setRequestState] = useState<{
    articleId: string;
    status: 'loading' | 'ready' | 'error';
  }>({ articleId, status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    if (!remote) return;
    setRequestState({ articleId, status: 'loading' });
    setAttempt((current) => current + 1);
  }, [articleId, remote]);

  useEffect(() => {
    if (!remote) return;
    let active = true;
    void refreshRemoteEditorialDetail(articleId)
      .then(() => { if (active) setRequestState({ articleId, status: 'ready' }); })
      .catch(() => { if (active) setRequestState({ articleId, status: 'error' }); });
    return () => { active = false; };
  }, [articleId, remote, attempt]);

  const article = remote && !getRemoteEditorialDetail(articleId)
    ? undefined
    : getEditorialArticle(articleId);
  const status = requestState.articleId === articleId ? requestState.status : 'loading';
  return { article, loading: remote && !article && status === 'loading',
    error: remote && !article && status === 'error', retry };
}
