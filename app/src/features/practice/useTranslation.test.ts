import { act, renderHook } from '@testing-library/react-native';
import type { TranslationDto } from '@context-reader/contracts';

import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import {
  getTranslation,
  recordAssistance,
  requestTranslation,
} from '@/api/practices';

import { useTranslation } from './useTranslation';

jest.mock('@/api/installation', () => ({
  createIdempotencyKey: jest.fn(),
}));
jest.mock('@/api/practices', () => ({
  getTranslation: jest.fn(),
  recordAssistance: jest.fn(),
  requestTranslation: jest.fn(),
}));

const mockedCreateIdempotencyKey = jest.mocked(createIdempotencyKey);
const mockedGetTranslation = jest.mocked(getTranslation);
const mockedRecordAssistance = jest.mocked(recordAssistance);
const mockedRequestTranslation = jest.mocked(requestTranslation);

const practiceId = '11111111-1111-4111-8111-111111111111';
const paragraphId = '22222222-2222-4222-8222-222222222222';
const translationId = '33333333-3333-4333-8333-333333333333';

function translation(
  status: TranslationDto['status'],
  text: string | null,
  pollAfterMs?: number,
): TranslationDto {
  return {
    id: translationId,
    status,
    scope: 'paragraph',
    paragraphId,
    translatedTextZh: text,
    ...(pollAfterMs === undefined ? {} : { pollAfterMs }),
    failure: null,
  };
}

describe('useTranslation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    mockedCreateIdempotencyKey
      .mockResolvedValueOnce('request_key_1234567890')
      .mockResolvedValueOnce('assistance_key_123456');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('requests, polls, reveals, then records assistance', async () => {
    const events: string[] = [];
    mockedRequestTranslation.mockImplementation(async () => {
      events.push('request');
      return translation('queued', null, 500);
    });
    mockedGetTranslation.mockImplementation(async () => {
      events.push('poll-ready');
      return translation('ready', '这是段落译文。');
    });
    mockedRecordAssistance.mockImplementation(async () => {
      events.push('record-assistance');
      return { recorded: true, hintMeaningZh: null };
    });

    const { result } = await renderHook(() => useTranslation(
      practiceId,
      { scope: 'paragraph', paragraphId },
    ));

    let showPromise: Promise<void> | undefined;
    await act(async () => {
      showPromise = result.current.show();
      await Promise.resolve();
    });

    expect(events).toEqual(['request']);
    expect(result.current.visible).toBe(false);
    expect(mockedRecordAssistance).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
      await showPromise;
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.visible).toBe(true);
    expect(result.current.translatedTextZh).toBe('这是段落译文。');
    expect(events).toEqual([
      'request',
      'poll-ready',
      'record-assistance',
    ]);
    expect(mockedRecordAssistance).toHaveBeenCalledWith(
      practiceId,
      { kind: 'paragraph_translation', paragraphId },
      'assistance_key_123456',
    );
  });

  it('records no assistance for terminal failure and retries with a new request key', async () => {
    mockedCreateIdempotencyKey.mockReset()
      .mockResolvedValueOnce('first_request_key_1234')
      .mockResolvedValueOnce('second_request_key_123')
      .mockResolvedValueOnce('assistance_key_123456');
    mockedRequestTranslation
      .mockResolvedValueOnce({
        ...translation('failed', null),
        failure: {
          code: 'AI_UNAVAILABLE',
          message: '翻译暂时无法完成',
          retryable: true,
        },
      })
      .mockResolvedValueOnce(translation('ready', '重试后的译文。'));
    mockedRecordAssistance.mockResolvedValue({
      recorded: true,
      hintMeaningZh: null,
    });

    const { result } = await renderHook(() => useTranslation(
      practiceId,
      { scope: 'paragraph', paragraphId },
    ));

    await act(async () => {
      await result.current.show();
    });
    expect(result.current.status).toBe('failed');
    expect(mockedRecordAssistance).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.visible).toBe(true);
    expect(mockedRequestTranslation.mock.calls.map((call) => call[2])).toEqual([
      'first_request_key_1234',
      'second_request_key_123',
    ]);
    expect(mockedRecordAssistance).toHaveBeenCalledTimes(1);
  });

  it('does not record assistance after the requesting view is abandoned', async () => {
    mockedRequestTranslation.mockResolvedValue(
      translation('queued', null, 500),
    );
    mockedGetTranslation.mockResolvedValue(
      translation('ready', '不应展示的译文。'),
    );

    const { result, unmount } = await renderHook(() => useTranslation(
      practiceId,
      { scope: 'paragraph', paragraphId },
    ));
    await act(async () => {
      void result.current.show();
      await Promise.resolve();
    });

    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mockedGetTranslation).not.toHaveBeenCalled();
    expect(mockedRecordAssistance).not.toHaveBeenCalled();
  });

  it('retains the active resource and keys across a network retry', async () => {
    mockedRequestTranslation.mockResolvedValue(
      translation('queued', null, 500),
    );
    mockedGetTranslation
      .mockRejectedValueOnce(
        new ApiError('NETWORK_ERROR', '网络连接失败', true),
      )
      .mockResolvedValueOnce(translation('ready', '恢复后的译文。'));
    mockedRecordAssistance.mockResolvedValue({
      recorded: true,
      hintMeaningZh: null,
    });

    const { result } = await renderHook(() => useTranslation(
      practiceId,
      { scope: 'paragraph', paragraphId },
    ));
    let showPromise: Promise<void> | undefined;
    await act(async () => {
      showPromise = result.current.show();
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
      await showPromise;
    });

    expect(result.current.error?.code).toBe('NETWORK_ERROR');
    expect(mockedRecordAssistance).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.status).toBe('ready');
    expect(mockedRequestTranslation).toHaveBeenCalledTimes(1);
    expect(mockedGetTranslation).toHaveBeenCalledTimes(2);
    expect(mockedCreateIdempotencyKey).toHaveBeenCalledTimes(2);
  });

  it('reuses the assistance key when a cached translation is reopened', async () => {
    mockedRequestTranslation.mockResolvedValue(
      translation('ready', '可重复查看的译文。'),
    );
    mockedRecordAssistance.mockResolvedValue({
      recorded: true,
      hintMeaningZh: null,
    });

    const { result } = await renderHook(() => useTranslation(
      practiceId,
      { scope: 'paragraph', paragraphId },
    ));
    await act(async () => {
      await result.current.show();
    });
    await act(async () => {
      result.current.hide();
    });
    await act(async () => {
      await result.current.show();
    });

    expect(mockedRecordAssistance).toHaveBeenCalledTimes(2);
    expect(mockedRecordAssistance.mock.calls.map((call) => call[2])).toEqual([
      'assistance_key_123456',
      'assistance_key_123456',
    ]);
    expect(mockedCreateIdempotencyKey).toHaveBeenCalledTimes(2);
  });
});
