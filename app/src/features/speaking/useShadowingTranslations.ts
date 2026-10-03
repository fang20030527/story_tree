import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { registerAnonymous } from '@/api/practices';
import { requestSentenceTranslation } from '@/api/sentences';
import type { SpeakingCue, SpeakingMaterial } from './model';

const CachedTranslationSchema = z.object({
  sourceText: z.string(),
  translatedTextZh: z.string().trim().min(1).max(4_000).regex(/\p{Script=Han}/u),
}).strict();
const CacheSchema = z.record(z.string(), CachedTranslationSchema);
type TranslationCache = z.infer<typeof CacheSchema>;
type TranslationState = { sourceText: string; status: 'loading' | 'error' };
const requests = new Map<string, Promise<string>>();
let writes: Promise<unknown> = Promise.resolve();

async function loadCache(key: string): Promise<TranslationCache> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? CacheSchema.parse(JSON.parse(raw)) : {};
  } catch { return {}; }
}

function translateCue(key: string, cue: SpeakingCue, authenticate: () => Promise<unknown>): Promise<string> {
  const requestKey = JSON.stringify([key, cue.id, cue.en]);
  const previous = requests.get(requestKey);
  if (previous) return previous;
  const request = (async () => {
    const cached = (await loadCache(key))[cue.id];
    if (cached?.sourceText === cue.en) return cached.translatedTextZh;
    await authenticate();
    const translated = CachedTranslationSchema.parse({
      sourceText: cue.en, translatedTextZh: await requestSentenceTranslation(cue.en),
    });
    // 同一素材的并发译文合并写入，避免后完成的请求覆盖先前缓存。
    const save = writes.then(async () => {
      const cache = await loadCache(key);
      cache[cue.id] = translated;
      await AsyncStorage.setItem(key, JSON.stringify(cache));
    });
    writes = save.catch(() => undefined);
    await writes;
    return translated.translatedTextZh;
  })().finally(() => { requests.delete(requestKey); });
  requests.set(requestKey, request);
  return request;
}

/** 平台字幕直接读取预置译文；仅为用户导入素材补齐当前句与可见字幕。 */
export function useShadowingTranslations(material: SpeakingMaterial, scope: string, currentIndex: number, enabled: boolean) {
  const usesApi = material.origin === 'file';
  const cacheKey = `context_reader_speaking_translation_v1:${scope}:${material.id}`;
  const authenticate = useMemo(() => {
    let registration: Promise<unknown> | undefined;
    return () => {
      if (!scope.endsWith(':guest')) return Promise.resolve();
      // 公开素材无需登录；新安装必须先登记匿名身份才能使用受保护的翻译接口。
      registration ??= registerAnonymous(true).catch(error => { registration = undefined; throw error; });
      return registration;
    };
  }, [scope]);
  const [cache, setCache] = useState<TranslationCache>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const ready = loadedKey === cacheKey;
  const [states, setStates] = useState<Record<string, TranslationState>>({});
  const [visibleIndexes, setVisibleIndexes] = useState<number[]>([]);
  const pending = useRef(new Set<string>());
  const alive = useRef(false);
  const generation = useRef(0);
  const nextRequestAt = useRef(0);
  useEffect(() => {
    let active = true;
    generation.current++;
    alive.current = true;
    pending.current.clear();
    void (usesApi ? loadCache(cacheKey) : Promise.resolve({})).then(value => { if (active) { setCache(value); setStates({}); setLoadedKey(cacheKey); } });
    return () => { active = false; alive.current = false; };
  }, [cacheKey, usesApi]);

  const cues = useMemo(() => !usesApi ? material.cues : material.cues.map(cue => {
    const cached = ready ? cache[cue.id] : undefined;
    return !cue.zh.trim() && cached?.sourceText === cue.en
      ? { ...cue, zh: cached.translatedTextZh } : cue;
  }), [material.cues, cache, ready, usesApi]);
  const showVisibleIndexes = useCallback((indexes: number[]) => {
    const next = [...new Set(indexes)].sort((a, b) => a - b);
    setVisibleIndexes(previous => previous.length === next.length && previous.every((value, index) => value === next[index]) ? previous : next);
  }, []);
  const retry = useCallback((start: number, end: number) => {
    setStates(previous => {
      const next = { ...previous };
      for (const cue of material.cues.slice(start, end + 1)) if (next[cue.id]?.status === 'error') delete next[cue.id];
      return next;
    });
  }, [material.cues]);

  useEffect(() => {
    if (!usesApi || !enabled || !ready || pending.current.size >= 2) return;
    const requestGeneration = generation.current;
    // 延迟到字幕停留后再翻译，恢复进度或快速滚动不会排队翻译整部影片。
    const timer = setTimeout(() => {
      const targets = [...new Set([currentIndex, currentIndex + 1, ...visibleIndexes])];
      const cue = targets.map(index => cues[index]).find(item => item && !item.zh.trim() && !pending.current.has(item.id)
        && !(states[item.id]?.sourceText === item.en && states[item.id]?.status === 'error'));
      if (cue) {
        // 句子接口每分钟最多 60 次，为其他翻译操作留出余量。
        nextRequestAt.current = Date.now() + 1_100;
        pending.current.add(cue.id);
        setStates(previous => ({ ...previous, [cue.id]: { sourceText: cue.en, status: 'loading' } }));
        void translateCue(cacheKey, cue, authenticate).then(translatedTextZh => {
          if (alive.current && generation.current === requestGeneration) setCache(previous => ({ ...previous, [cue.id]: { sourceText: cue.en, translatedTextZh } }));
        }).catch(() => {
          if (alive.current && generation.current === requestGeneration) setStates(previous => ({ ...previous, [cue.id]: { sourceText: cue.en, status: 'error' } }));
        }).finally(() => {
          if (generation.current !== requestGeneration) return;
          pending.current.delete(cue.id);
          if (alive.current) setStates(previous => {
            if (previous[cue.id]?.sourceText !== cue.en || previous[cue.id]?.status !== 'loading') return { ...previous };
            const next = { ...previous }; delete next[cue.id]; return next;
          });
        });
      }
    }, Math.max(300, nextRequestAt.current - Date.now()));
    return () => clearTimeout(timer);
  }, [usesApi, enabled, ready, cues, currentIndex, visibleIndexes, states, cacheKey, authenticate]);

  return { cues, states, showVisibleIndexes, retry };
}
