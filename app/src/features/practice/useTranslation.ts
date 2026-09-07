import type {
  AssistanceRequest,
  TranslationDto,
  TranslationRequest,
} from '@context-reader/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import {
  getTranslation,
  recordAssistance,
  requestTranslation,
} from '@/api/practices';

export type TranslationViewStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface TranslationViewState {
  status: TranslationViewStatus;
  translatedTextZh: string | null;
  visible: boolean;
  error: ApiError | null;
  show: () => Promise<void>;
  hide: () => void;
  retry: () => Promise<void>;
}

function toTranslationError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(
    'TRANSLATION_UNAVAILABLE',
    '翻译暂时无法完成',
    true,
  );
}

function terminalTranslationError(translation: TranslationDto): ApiError {
  return new ApiError(
    translation.failure?.code ?? 'TRANSLATION_FAILED',
    translation.failure?.message ?? '翻译暂时无法完成',
    translation.failure?.retryable ?? true,
  );
}

function assistanceFor(request: TranslationRequest): AssistanceRequest {
  return request.scope === 'full'
    ? { kind: 'full_translation' }
    : {
        kind: 'paragraph_translation',
        paragraphId: request.paragraphId,
      };
}

function scopeIdentity(request: TranslationRequest): string {
  return request.scope === 'full'
    ? 'full'
    : `paragraph:${request.paragraphId}`;
}

export function useTranslation(
  practiceId: string,
  request: TranslationRequest,
): TranslationViewState {
  const [status, setStatus] = useState<TranslationViewStatus>('idle');
  const [translatedTextZh, setTranslatedTextZh] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const mountedRef = useRef(true);
  const visibleRef = useRef(false);
  const textRef = useRef<string | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  const assistanceKeyRef = useRef<string | null>(null);
  const translationIdRef = useRef<string | null>(null);
  const terminalFailureRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const identity = `${practiceId}:${scopeIdentity(request)}`;

  const waitForPoll = useCallback((delayMs: number) => (
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        resolve();
      }, delayMs);
      timersRef.current.add(timer);
    })
  ), []);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    requestKeyRef.current = null;
    assistanceKeyRef.current = null;
    translationIdRef.current = null;
    terminalFailureRef.current = false;
    textRef.current = null;
    visibleRef.current = false;
    setStatus('idle');
    setTranslatedTextZh(null);
    setVisible(false);
    setError(null);
  }, [identity]);

  const getRequestKey = useCallback(async () => {
    if (!requestKeyRef.current) {
      requestKeyRef.current = await createIdempotencyKey();
    }
    return requestKeyRef.current;
  }, []);

  const getAssistanceKey = useCallback(async () => {
    if (!assistanceKeyRef.current) {
      assistanceKeyRef.current = await createIdempotencyKey();
    }
    return assistanceKeyRef.current;
  }, []);

  const pollToTerminalState = useCallback(async (
    initial: TranslationDto,
  ): Promise<TranslationDto> => {
    let current = initial;
    while (current.status === 'queued' || current.status === 'generating') {
      await waitForPoll(current.pollAfterMs ?? 1_000);
      if (!mountedRef.current) return current;
      current = await getTranslation(current.id);
      translationIdRef.current = current.id;
    }
    return current;
  }, [waitForPoll]);

  const loadReadyTranslation = useCallback(async (): Promise<string> => {
    let translation: TranslationDto;
    if (translationIdRef.current) {
      translation = await getTranslation(translationIdRef.current);
    } else {
      const idempotencyKey = await getRequestKey();
      translation = await requestTranslation(
        practiceId,
        requestRef.current,
        idempotencyKey,
      );
      translationIdRef.current = translation.id;
    }

    translation = await pollToTerminalState(translation);
    if (translation.status === 'failed') {
      terminalFailureRef.current = true;
      throw terminalTranslationError(translation);
    }
    if (translation.status !== 'ready' || !translation.translatedTextZh?.trim()) {
      throw new ApiError(
        'INVALID_SERVER_RESPONSE',
        '服务返回了无法识别的数据',
        true,
      );
    }
    terminalFailureRef.current = false;
    return translation.translatedTextZh;
  }, [getRequestKey, pollToTerminalState, practiceId]);

  const recordVisibleAssistance = useCallback(async () => {
    const idempotencyKey = await getAssistanceKey();
    await recordAssistance(
      practiceId,
      assistanceFor(requestRef.current),
      idempotencyKey,
    );
  }, [getAssistanceKey, practiceId]);

  const runShow = useCallback(async () => {
    try {
      setError(null);
      let text = textRef.current;
      if (!text) {
        setStatus('loading');
        text = await loadReadyTranslation();
      }
      if (!mountedRef.current) return;

      textRef.current = text;
      visibleRef.current = true;
      setTranslatedTextZh(text);
      setVisible(true);
      setStatus('ready');
      await Promise.resolve();
      if (!mountedRef.current) return;
      await recordVisibleAssistance();
    } catch (nextError) {
      if (!mountedRef.current) return;
      setError(toTranslationError(nextError));
      if (!textRef.current) setStatus('failed');
    }
  }, [loadReadyTranslation, recordVisibleAssistance]);

  const startShow = useCallback((): Promise<void> => {
    if (visibleRef.current && !error) return Promise.resolve();
    if (inFlightRef.current) return inFlightRef.current;
    const operation = runShow().finally(() => {
      if (inFlightRef.current === operation) inFlightRef.current = null;
    });
    inFlightRef.current = operation;
    return operation;
  }, [error, runShow]);

  const hide = useCallback(() => {
    visibleRef.current = false;
    setVisible(false);
  }, []);

  const retry = useCallback(() => {
    if (terminalFailureRef.current) {
      requestKeyRef.current = null;
      translationIdRef.current = null;
      terminalFailureRef.current = false;
    }
    return startShow();
  }, [startShow]);

  return {
    status,
    translatedTextZh,
    visible,
    error,
    show: startShow,
    hide,
    retry,
  };
}
