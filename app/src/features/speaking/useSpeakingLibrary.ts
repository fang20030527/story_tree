import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { speakingMaterials } from './catalog';
import { emptySpeakingStore, type SpeakingStore } from './model';
import { loadSpeakingStore, speakingStorageKey, updateSpeakingStore } from './speakingStorage';
import { getSpeakingCatalog, getSpeakingCatalogMaterial, getSpeakingLibrary, getSpeakingMaterial, getSpeakingState } from '@/api/speaking';
import { cacheSpeakingDetails, cacheSpeakingPublicDetails, mergeSpeakingCatalog, mergeSpeakingCloudLibrary } from './cloudSync';

export function useSpeakingLibrary(materialId?: string) {
  const [store, setStore] = useState(emptySpeakingStore);
  const [scope, setScope] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [revision, setRevision] = useState(0);
  const [cloud, setCloud] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const alive = useRef(false);
  const moreRequest = useRef<symbol | null>(null);
  const generation = useRef(0);
  useFocusEffect(useCallback(() => {
    // revision 是用户重试时的新读取请求编号。
    const request = revision;
    let active = true;
    alive.current = true;
    generation.current++;
    moreRequest.current = null;
    setLoadingMore(false);
    setLoading(true);
    void speakingStorageKey().then(async key => {
      const result = await loadSpeakingStore(key);
      const registered = !key.endsWith(':guest');
      if (active) { setScope(key); setStore(result); setCloud(registered); }
      const [catalog, account] = await Promise.allSettled([
        getSpeakingCatalog(), registered ? getSpeakingLibrary({ limit: 20 }) : Promise.resolve(null),
      ]);
      if (!active || await speakingStorageKey() !== key) return;
      let merged = await updateSpeakingStore(current => {
        if (catalog.status === 'fulfilled') mergeSpeakingCatalog(current, catalog.value, registered);
        if (account.status === 'fulfilled' && account.value) mergeSpeakingCloudLibrary(current, account.value);
      }, key);
      if (active) {
        setStore(merged);
        setCatalogError(catalog.status === 'rejected' ? '共享素材目录读取失败，请重试' : '');
      }
      if (account.status === 'rejected') throw account.reason;
      const selectedLocal = materialId ? merged.files.find(item => item.id === materialId && item.storage !== 'cloud') : undefined;
      if (materialId && !selectedLocal) {
        if (registered) {
          const [details, state] = await Promise.all([getSpeakingMaterial(materialId), getSpeakingState(materialId)]);
          if (!active || await speakingStorageKey() !== key) return;
          merged = await updateSpeakingStore(current => cacheSpeakingDetails(current, details, state), key);
        } else {
          const details = await getSpeakingCatalogMaterial(materialId);
          if (!active || await speakingStorageKey() !== key) return;
          merged = await updateSpeakingStore(current => cacheSpeakingPublicDetails(current, details), key);
        }
      }
      if (active && request === revision) { setStore(merged); setNextCursor(account.value?.nextCursor ?? null); setMoreError(''); setError(''); }
    }).catch((failure) => { if (active) setError(failure instanceof Error ? `口语资源读取失败：${failure.message}，请重试` : '口语记录读取失败，请重试'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; alive.current = false; generation.current++; };
  }, [revision, materialId]));
  const loadMore = useCallback(async () => {
    if (!scope || !nextCursor || loading || moreRequest.current) return;
    const requestGeneration = generation.current;
    const requestToken = Symbol('speaking-page');
    moreRequest.current = requestToken; setLoadingMore(true); setMoreError('');
    try {
      if (await speakingStorageKey() !== scope) throw new Error('登录状态已变化，请重新打开文件页');
      const remote = await getSpeakingLibrary({ limit: 20, cursor: nextCursor });
      if (!alive.current || generation.current !== requestGeneration || await speakingStorageKey() !== scope) return;
      const merged = await updateSpeakingStore(current => { mergeSpeakingCloudLibrary(current, remote); }, scope);
      if (alive.current && generation.current === requestGeneration) { setStore(merged); setNextCursor(remote.nextCursor); }
    } catch (failure) { if (alive.current && generation.current === requestGeneration) setMoreError(failure instanceof Error ? failure.message : '更多文件读取失败，请重试'); }
    finally { if (moreRequest.current === requestToken) moreRequest.current = null; if (alive.current && generation.current === requestGeneration) setLoadingMore(false); }
  }, [scope, nextCursor, loading]);
  const materials = speakingMaterials(store);
  const accept = useCallback((next: SpeakingStore) => setStore(next), []);
  return { store, scope, materials, loading, error, catalogError, cloud, loadingMore, moreError, hasMore: nextCursor !== null, loadMore, accept, refresh: () => setRevision(value => value + 1) };
}
