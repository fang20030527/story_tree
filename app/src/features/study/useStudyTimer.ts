import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState } from 'react-native';
import { recordStudyInterval, studyStorageKey } from './studyStorage';

export function useStudyTimer(enabled: boolean) {
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    const key = studyStorageKey();
    // 提前处理凭据读取失败，避免尚未计时就产生未处理的 rejection。
    void key.catch(() => undefined);
    let started = AppState.currentState === 'active' ? Date.now() : null;
    const flush = () => {
      if (started === null) return;
      const end = Date.now();
      const start = started;
      started = end;
      void recordStudyInterval(key, start, end).catch(() => {
        console.warn('学习时长保存失败');
      });
    };
    const subscription = AppState.addEventListener('change', (state) => {
      flush();
      started = state === 'active' ? Date.now() : null;
    });
    const interval = setInterval(flush, 5_000);
    return () => {
      clearInterval(interval);
      subscription.remove();
      flush();
    };
  }, [enabled]));
}
