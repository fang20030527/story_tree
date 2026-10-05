import type { MessageBottleModerationItem, MessageBottleModerationView } from '@context-reader/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { getModerationBottles } from '@/api/messageBottleDeveloper';
import { messageBottleError } from './useMessageBottles';

export function useMessageBottleModeration(onRevoke: () => void) {
  const [view, setView] = useState<MessageBottleModerationView>('pending');
  const [items, setItems] = useState<MessageBottleModerationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(false);
  const scope = useRef(0);
  const version = useRef(0);
  const busyRef = useRef(false);
  const loadingRef = useRef(false);
  const moreRef = useRef(false);

  const revokeIfNeeded = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && ['DEVELOPER_REQUIRED', 'UNAUTHORIZED', 'TOKEN_REVOKED'].includes(cause.code)) {
      ++version.current; ++scope.current; setItems([]); setNextCursor(null); onRevoke(); return true;
    }
    return false;
  }, [onRevoke]);

  const refresh = useCallback(async () => {
    if (!active.current || loadingRef.current) return;
    const current = ++version.current;
    loadingRef.current = true; moreRef.current = false;
    setLoading(true); setLoadingMore(false); setError(null);
    try {
      const page = await getModerationBottles(view);
      if (active.current && current === version.current) { setItems(page.items); setNextCursor(page.nextCursor); }
    } catch (cause) {
      if (active.current && current === version.current && !revokeIfNeeded(cause)) setError(messageBottleError(cause, '审核留言暂时无法读取，请重试'));
    } finally {
      if (active.current && current === version.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [view, revokeIfNeeded]);

  useFocusEffect(useCallback(() => {
    active.current = true; ++scope.current; setItems([]); setNextCursor(null); setActionError(null); setNotice(null);
    void refresh();
    return () => { active.current = false; ++scope.current; ++version.current; loadingRef.current = false; moreRef.current = false;
      busyRef.current = false; setBusy(false); setItems([]); setNextCursor(null); };
  }, [refresh]));

  const loadMore = async () => {
    if (!active.current || !nextCursor || loadingRef.current || moreRef.current || busyRef.current) return;
    const current = version.current;
    moreRef.current = true; setLoadingMore(true); setError(null);
    try {
      const page = await getModerationBottles(view, nextCursor);
      if (active.current && current === version.current) {
        setItems(previous => { const ids = new Set(previous.map(item => item.id)); return [...previous, ...page.items.filter(item => !ids.has(item.id))]; });
        setNextCursor(page.nextCursor);
      }
    } catch (cause) {
      if (active.current && current === version.current && !revokeIfNeeded(cause)) setError(messageBottleError(cause, '更多审核留言暂时无法读取，请重试'));
    } finally {
      if (active.current && current === version.current) { moreRef.current = false; setLoadingMore(false); }
    }
  };

  const run = async (operation: () => Promise<unknown>, success: string): Promise<boolean> => {
    if (!active.current || busyRef.current || loadingRef.current) return false;
    const currentScope = scope.current;
    busyRef.current = true; setBusy(true); setActionError(null); setNotice(null);
    try {
      await operation();
      if (!active.current || currentScope !== scope.current) return false;
      setNotice(success); await refresh();
      return active.current && currentScope === scope.current;
    } catch (cause) {
      if (active.current && currentScope === scope.current && !revokeIfNeeded(cause))
        setActionError(messageBottleError(cause, '操作没有完成，请重试'));
      return false;
    } finally {
      if (active.current && currentScope === scope.current) { busyRef.current = false; setBusy(false); }
    }
  };
  return { view, setView, items, nextCursor, loading, loadingMore, busy, error, actionError, notice, refresh, loadMore, run };
}
