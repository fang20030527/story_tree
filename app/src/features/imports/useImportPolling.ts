import type { ArticleImportDto } from '@context-reader/contracts';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError } from '@/api/client';
import { getArticleImport } from '@/api/imports';

const POLLING_STATUSES = new Set<ArticleImportDto['status']>([
  'awaiting_upload',
  'queued',
  'processing',
]);

export interface ImportPollingResult {
  articleImport: ArticleImportDto | null;
  error: ApiError | null;
  retry: () => void;
}

function toPollingError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError('IMPORT_STATUS_UNAVAILABLE', '暂时无法获取导入状态', true);
}

export function useImportPolling(importId: string | null): ImportPollingResult {
  const [articleImport, setArticleImport] = useState<ArticleImportDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    if (!importId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let appState = AppState.currentState;

    const clearTimer = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    };

    const poll = async () => {
      if (appState !== 'active') return;
      setError(null);
      try {
        const next = await getArticleImport(importId);
        if (cancelled) return;
        setArticleImport(next);
        if (appState === 'active' && POLLING_STATUSES.has(next.status)) {
          timer = setTimeout(() => void poll(), next.pollAfterMs ?? 1_000);
        }
      } catch (nextError) {
        if (!cancelled) setError(toPollingError(nextError));
      }
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState === 'active';
      appState = nextState;
      clearTimer();
      if (!wasActive && nextState === 'active') void poll();
    });

    if (appState === 'active') void poll();
    return () => {
      cancelled = true;
      clearTimer();
      subscription.remove();
    };
  }, [importId, retryCount]);

  return { articleImport, error, retry };
}
