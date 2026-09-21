import type { PracticeDto } from '@context-reader/contracts';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError } from '@/api/client';
import { getPractice } from '@/api/practices';

const POLLING_STATUSES = new Set<PracticeDto['status']>([
  'queued',
  'generating',
  'validating',
]);

export interface PracticePollingResult {
  practice: PracticeDto | null;
  error: ApiError | null;
  retry: () => void;
}

function toPollingError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(
    'PRACTICE_STATUS_UNAVAILABLE',
    '暂时无法获取生成状态',
    true,
  );
}

export function usePracticePolling(
  practiceId: string,
): PracticePollingResult {
  const [practice, setPractice] = useState<PracticeDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => {
    setRetryCount((count) => count + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let appState = AppState.currentState;
    let consecutiveErrors = 0;
    let inFlight = false;

    const clearTimer = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    };

    const poll = async () => {
      if (cancelled || appState !== 'active' || inFlight) return;
      clearTimer();
      inFlight = true;

      let nextPractice: PracticeDto;
      try {
        nextPractice = await getPractice(practiceId);
      } catch (nextError) {
        if (!cancelled) {
          const pollingError = toPollingError(nextError);
          setError(pollingError);
          consecutiveErrors += 1;
          if (pollingError.retryable && appState === 'active') {
            timer = setTimeout(() => void poll(), Math.min(30_000, 2_000 * 2 ** Math.min(consecutiveErrors - 1, 4)));
          }
        }
        return;
      } finally {
        inFlight = false;
      }

      if (cancelled) return;
      consecutiveErrors = 0;
      setError(null);
      setPractice(nextPractice);
      if (
        appState === 'active'
        && (POLLING_STATUSES.has(nextPractice.status)
          || nextPractice.group?.articles.some((article) => POLLING_STATUSES.has(article.status)))
      ) {
        timer = setTimeout(
          () => void poll(),
          nextPractice.pollAfterMs ?? 1_000,
        );
      }
    };

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextAppState) => {
        const wasActive = appState === 'active';
        appState = nextAppState;
        clearTimer();
        if (!wasActive && nextAppState === 'active') void poll();
      },
    );

    if (appState === 'active') void poll();
    return () => {
      cancelled = true;
      clearTimer();
      appStateSubscription.remove();
    };
  }, [practiceId, retryCount]);

  return { practice, error, retry };
}
