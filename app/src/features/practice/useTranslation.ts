import type {
  AssistanceRequest,
  TranslationDto,
  TranslationRequest,
} from '@context-reader/contracts';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import {
  getArticleTranslation,
  requestArticleTranslation,
} from '@/api/imports';
import {
  getTranslation,
  recordAssistance,
  requestTranslation,
} from '@/api/practices';

export type TranslationViewStatus = 'idle' | 'loading' | 'ready' | 'failed';
export type TranslationResource = 'practice' | 'article';

export interface TranslationViewState {
  status: TranslationViewStatus;
  translatedTextZh: string | null;
  visible: boolean;
  error: ApiError | null;
  show: () => Promise<void>;
  hide: () => void;
  retry: () => Promise<void>;
}

interface TranslationState {
  status: TranslationViewStatus;
  translatedTextZh: string | null;
  visible: boolean;
  error: ApiError | null;
}

type TranslationAction =
  | { type: 'reset' }
  | { type: 'clear-error' }
  | { type: 'loading' }
  | { type: 'ready'; text: string }
  | { type: 'failed'; error: ApiError }
  | { type: 'assistance-failed'; error: ApiError }
  | { type: 'hide' };

const INITIAL_TRANSLATION_STATE: TranslationState = {
  status: 'idle',
  translatedTextZh: null,
  visible: false,
  error: null,
};

function translationReducer(
  state: TranslationState,
  action: TranslationAction,
): TranslationState {
  switch (action.type) {
    case 'reset':
      return INITIAL_TRANSLATION_STATE;
    case 'clear-error':
      return { ...state, error: null };
    case 'loading':
      return { ...state, status: 'loading', error: null };
    case 'ready':
      return {
        ...state,
        status: 'ready',
        translatedTextZh: action.text,
        visible: true,
        error: null,
      };
    case 'failed':
      return { ...state, status: 'failed', error: action.error };
    case 'assistance-failed':
      return { ...state, error: action.error };
    case 'hide':
      return { ...state, visible: false };
  }
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
  resourceId: string,
  request: TranslationRequest,
  resource: TranslationResource = 'practice',
): TranslationViewState {
  const [state, dispatch] = useReducer(
    translationReducer,
    INITIAL_TRANSLATION_STATE,
  );
  const requestRef = useRef(request);
  const mountedRef = useRef(true);
  const visibleRef = useRef(false);
  const textRef = useRef<string | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  const assistanceKeyRef = useRef<string | null>(null);
  const translationIdRef = useRef<string | null>(null);
  const terminalFailureRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const requestTranslationResource = resource === 'article'
    ? requestArticleTranslation
    : requestTranslation;
  const getTranslationResource = resource === 'article'
    ? getArticleTranslation
    : getTranslation;
  const recordAssistanceResource = resource === 'article'
    ? null
    : recordAssistance;
  const identity = `${resource}:${resourceId}:${scopeIdentity(request)}`;

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
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    requestKeyRef.current = null;
    assistanceKeyRef.current = null;
    translationIdRef.current = null;
    terminalFailureRef.current = false;
    textRef.current = null;
    visibleRef.current = false;
    dispatch({ type: 'reset' });
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
      current = await getTranslationResource(current.id);
      translationIdRef.current = current.id;
    }
    return current;
  }, [getTranslationResource, waitForPoll]);

  const loadReadyTranslation = useCallback(async (): Promise<string> => {
    let translation: TranslationDto;
    if (translationIdRef.current) {
      translation = await getTranslationResource(translationIdRef.current);
    } else {
      const idempotencyKey = await getRequestKey();
      translation = await requestTranslationResource(
        resourceId,
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
  }, [getRequestKey, getTranslationResource, pollToTerminalState, requestTranslationResource, resourceId]);

  const recordVisibleAssistance = useCallback(async () => {
    if (!recordAssistanceResource) return;
    const idempotencyKey = await getAssistanceKey();
    await recordAssistanceResource(
      resourceId,
      assistanceFor(requestRef.current),
      idempotencyKey,
    );
  }, [getAssistanceKey, recordAssistanceResource, resourceId]);

  const runShow = useCallback(async () => {
    try {
      dispatch({ type: 'clear-error' });
      let text = textRef.current;
      if (!text) {
        dispatch({ type: 'loading' });
        text = await loadReadyTranslation();
      }
      if (!mountedRef.current) return;

      textRef.current = text;
      visibleRef.current = true;
      dispatch({ type: 'ready', text });
      await Promise.resolve();
      if (!mountedRef.current) return;
      await recordVisibleAssistance();
    } catch (nextError) {
      if (!mountedRef.current) return;
      const error = toTranslationError(nextError);
      dispatch({
        type: textRef.current ? 'assistance-failed' : 'failed',
        error,
      });
    }
  }, [loadReadyTranslation, recordVisibleAssistance]);

  const startShow = useCallback((): Promise<void> => {
    if (visibleRef.current && !state.error) return Promise.resolve();
    if (inFlightRef.current) return inFlightRef.current;
    const operation = runShow().finally(() => {
      if (inFlightRef.current === operation) inFlightRef.current = null;
    });
    inFlightRef.current = operation;
    return operation;
  }, [runShow, state.error]);

  const hide = useCallback(() => {
    visibleRef.current = false;
    dispatch({ type: 'hide' });
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
    status: state.status,
    translatedTextZh: state.translatedTextZh,
    visible: state.visible,
    error: state.error,
    show: startShow,
    hide,
    retry,
  };
}
