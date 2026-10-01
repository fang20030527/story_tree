import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type LearningMode = 'read' | 'speak';
const KEY = '@black-hole/learning-mode:v1';
const LearningModeContext = createContext<{ mode: LearningMode; setMode: (mode: LearningMode) => void } | null>(null);

export function LearningModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setState] = useState<LearningMode>('read');
  const changed = useRef(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(KEY).then(value => {
      if (mounted && !changed.current && (value === 'read' || value === 'speak')) setState(value);
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);
  const setMode = useCallback((value: LearningMode) => {
    changed.current = true;
    setState(value);
    writes.current = writes.current.then(() => AsyncStorage.setItem(KEY, value)).catch(() => undefined);
  }, []);
  return <LearningModeContext.Provider value={{ mode, setMode }}>{children}</LearningModeContext.Provider>;
}

export function useLearningMode() {
  const context = useContext(LearningModeContext);
  if (!context) throw new Error('LearningModeProvider is required');
  return context;
}
