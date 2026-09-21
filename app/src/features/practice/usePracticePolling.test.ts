import { act, renderHook } from '@testing-library/react-native';
import type { PracticeDto } from '@context-reader/contracts';
import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

import { ApiError } from '@/api/client';
import { getPractice } from '@/api/practices';

import { usePracticePolling } from './usePracticePolling';

jest.mock('@/api/practices', () => ({
  getPractice: jest.fn(),
}));

const mockedGetPractice = jest.mocked(getPractice);
const practiceId = '11111111-1111-4111-8111-111111111111';
let currentAppState: AppStateStatus;
let appStateListener: ((state: AppStateStatus) => void) | undefined;
let removeAppStateListener: jest.Mock;

function practice(
  status: PracticeDto['status'],
  pollAfterMs?: number,
): PracticeDto {
  return {
    id: practiceId,
    status,
    modelName: null,
    remainingFreePractices: 2,
    ...(pollAfterMs === undefined ? {} : { pollAfterMs }),
    failure: null,
    article: null,
    questions: [],
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('usePracticePolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    currentAppState = 'active';
    appStateListener = undefined;
    removeAppStateListener = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(
      (_type, listener) => {
        appStateListener = listener;
        return {
          remove: removeAppStateListener,
        } as NativeEventSubscription;
      },
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      get: () => currentAppState,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('continues polling siblings after the first article is ready', async () => {
    const grouped: PracticeDto = {
      ...practice('ready', 500),
      group: { id: practiceId, articles: (['经济', '文化', '政治', '科技'] as const).map((topic, index) => ({
        id: practiceId, topic, status: index === 0 ? 'ready' : 'generating',
        title: null, wordCount: null, failureMessage: null,
      })) },
    };
    mockedGetPractice.mockResolvedValue(grouped);
    await renderHook(() => usePracticePolling(practiceId));
    await flushPromises();
    expect(mockedGetPractice).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(500); });
    await flushPromises();
    expect(mockedGetPractice).toHaveBeenCalledTimes(2);
  });

  it('recovers from malformed data after the first article failed and discovers a ready sibling', async () => {
    const grouped: PracticeDto = {
      ...practice('failed', 500),
      group: { id: practiceId, articles: (['经济', '文化', '政治', '科技'] as const).map((topic, index) => ({
        id: practiceId, topic, status: index === 0 ? 'failed' : 'generating',
        title: null, wordCount: null, failureMessage: null,
      })) },
    };
    const done = structuredClone(grouped);
    done.group!.articles.slice(1).forEach((article) => { article.status = 'ready'; });
    mockedGetPractice.mockResolvedValueOnce(grouped)
      .mockRejectedValueOnce(new ApiError('INVALID_SERVER_RESPONSE', '服务返回了无法识别的数据', true))
      .mockResolvedValueOnce(done);
    const { result } = await renderHook(() => usePracticePolling(practiceId));
    await flushPromises();
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(result.current.practice).toEqual(grouped);
    expect(result.current.error).not.toBeNull();
    await act(async () => { jest.advanceTimersByTime(2_000); });
    expect(result.current.practice).toEqual(done);
    expect(result.current.error).toBeNull();
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(mockedGetPractice).toHaveBeenCalledTimes(3);
  });

  it('does not retry authorization failures automatically', async () => {
    mockedGetPractice.mockRejectedValue(new ApiError('UNAUTHORIZED', '请重新登录', false));
    const { result } = await renderHook(() => usePracticePolling(practiceId));
    await flushPromises();
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(mockedGetPractice).toHaveBeenCalledTimes(1);
    expect(result.current.error?.code).toBe('UNAUTHORIZED');
  });

  it('follows server polling delays until the practice becomes ready', async () => {
    mockedGetPractice
      .mockResolvedValueOnce(practice('queued', 500))
      .mockResolvedValueOnce(practice('generating', 700))
      .mockResolvedValueOnce(practice('ready'));

    const { result } = await renderHook(() => usePracticePolling(practiceId));
    await flushPromises();

    expect(result.current.practice?.status).toBe('queued');
    expect(mockedGetPractice).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(499);
    });
    expect(mockedGetPractice).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(result.current.practice?.status).toBe('generating');

    await act(async () => {
      jest.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(result.current.practice?.status).toBe('ready');
    expect(mockedGetPractice).toHaveBeenCalledTimes(3);

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(mockedGetPractice).toHaveBeenCalledTimes(3);
  });

  it('cancels scheduled polling and the app-state listener on unmount', async () => {
    mockedGetPractice.mockResolvedValue(practice('queued', 500));

    const { unmount } = await renderHook(
      () => usePracticePolling(practiceId),
    );
    await flushPromises();

    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mockedGetPractice).toHaveBeenCalledTimes(1);
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  it('pauses in the background and refreshes immediately when active', async () => {
    mockedGetPractice
      .mockResolvedValueOnce(practice('queued', 500))
      .mockResolvedValueOnce(practice('ready'));

    const { result } = await renderHook(
      () => usePracticePolling(practiceId),
    );
    await flushPromises();

    await act(async () => {
      currentAppState = 'background';
      appStateListener?.('background');
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(mockedGetPractice).toHaveBeenCalledTimes(1);

    await act(async () => {
      currentAppState = 'active';
      appStateListener?.('active');
      await Promise.resolve();
    });
    expect(mockedGetPractice).toHaveBeenCalledTimes(2);
    expect(result.current.practice?.status).toBe('ready');
  });

  it('stops on terminal failure and exposes the public message', async () => {
    mockedGetPractice.mockResolvedValue({
      ...practice('failed'),
      failure: {
        code: 'AI_UNAVAILABLE',
        message: '文章暂时无法生成',
        retryable: false,
      },
    });

    const { result } = await renderHook(
      () => usePracticePolling(practiceId),
    );
    await flushPromises();
    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(result.current.practice?.failure?.message).toBe(
      '文章暂时无法生成',
    );
    expect(mockedGetPractice).toHaveBeenCalledTimes(1);
  });

  it('keeps the last state after a network error and automatically recovers', async () => {
    mockedGetPractice
      .mockResolvedValueOnce(practice('queued', 500))
      .mockRejectedValueOnce(
        new ApiError('NETWORK_ERROR', '网络连接失败', true),
      )
      .mockResolvedValueOnce(practice('ready'));

    const { result } = await renderHook(
      () => usePracticePolling(practiceId),
    );
    await flushPromises();
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(result.current.practice?.status).toBe('queued');
    expect(result.current.error?.message).toBe('网络连接失败');

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(result.current.practice?.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(mockedGetPractice).toHaveBeenCalledTimes(3);
  });
});
