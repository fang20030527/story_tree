import type {
  CreateMessageBottle, MessageBottleProfile, MessageBottleReportReason, MessageBottleReviewedDto,
} from '@context-reader/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import {
  blockMessageBottleAuthor, createMessageBottle, getMessageBottleProfile, getMessageBottles, reportMessageBottle,
} from '@/api/messageBottles';
import { registerAnonymous } from '@/api/practices';

export function messageBottleError(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}
export function useMessageBottles() {
  const [items, setItems] = useState<MessageBottleReviewedDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [profile, setProfile] = useState<MessageBottleProfile | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const active = useRef(false);
  const scope = useRef(0);
  const version = useRef(0);
  const refreshingRef = useRef(false);
  const moreRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!active.current || refreshingRef.current) return;
    const requestVersion = ++version.current;
    refreshingRef.current = true; moreRef.current = false;
    setRefreshing(true); setLoadingMore(false); setError(null); setMoreError(null); setProfileError(null);
    try {
      await registerAnonymous(true);
      if (!active.current || version.current !== requestVersion) return;
      const [page, account] = await Promise.allSettled([getMessageBottles(), getMessageBottleProfile()]);
      if (!active.current || version.current !== requestVersion) return;
      if (page.status === 'fulfilled') { setItems(page.value.items); setNextCursor(page.value.nextCursor); }
      else setError(messageBottleError(page.reason, '留言暂时无法读取，请重试'));
      if (account.status === 'fulfilled') setProfile(account.value);
      else { setProfile(null); setProfileError(messageBottleError(account.reason, '账号信息暂时无法读取，请重试')); }
    } catch (cause) {
      if (active.current && version.current === requestVersion) {
        const message = messageBottleError(cause, '留言暂时无法读取，请重试');
        setError(message); setProfileError(message); setProfile(null);
      }
    } finally {
      if (active.current && version.current === requestVersion) { refreshingRef.current = false; setRefreshing(false); }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    active.current = true; ++scope.current; setProfile(null);
    void refresh();
    return () => { active.current = false; ++scope.current; ++version.current; refreshingRef.current = false; moreRef.current = false; };
  }, [refresh]));

  const loadMore = useCallback(async () => {
    if (!active.current || !nextCursor || refreshingRef.current || moreRef.current) return;
    const requestVersion = version.current;
    moreRef.current = true; setLoadingMore(true); setMoreError(null);
    try {
      const page = await getMessageBottles(nextCursor);
      if (!active.current || requestVersion !== version.current) return;
      setItems(previous => { const ids = new Set(previous.map(item => item.id)); return [...previous, ...page.items.filter(item => !ids.has(item.id))]; });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (active.current && requestVersion === version.current) setMoreError(messageBottleError(cause, '更多留言暂时无法读取，请重试'));
    } finally {
      if (active.current && requestVersion === version.current) { moreRef.current = false; setLoadingMore(false); }
    }
  }, [nextCursor]);

  const post = useCallback(async (input: CreateMessageBottle, key: string) => {
    const currentScope = scope.current;
    const message = await createMessageBottle(input, key);
    if (active.current && currentScope === scope.current) {
      ++version.current; refreshingRef.current = false; moreRef.current = false;
      setRefreshing(false); setLoadingMore(false); setMoreError(null);
      setItems(previous => [message, ...previous.filter(item => item.id !== message.id)].sort((left, right) => {
        const a = `${left.createdAt}_${left.id}`; const b = `${right.createdAt}_${right.id}`;
        return a < b ? 1 : a > b ? -1 : 0;
      }));
      setProfile({ username: message.username, canPost: true });
    }
    return message;
  }, []);

  // A reported bottle, and every bottle by a blocked author, leave the list at once.
  const report = useCallback(async (item: MessageBottleReviewedDto, reason: MessageBottleReportReason) => {
    await reportMessageBottle(item.id, { reason });
    setItems(previous => previous.filter(entry => entry.id !== item.id));
  }, []);
  const block = useCallback(async (item: MessageBottleReviewedDto) => {
    await blockMessageBottleAuthor(item.id);
    // The name hides the author's bottles at once; the reload filters by account on the server.
    setItems(previous => previous.filter(entry => entry.isMine || entry.username !== item.username));
    void refresh();
  }, [refresh]);

  return { items, nextCursor, profile, refreshing, loadingMore, error, profileError, moreError, refresh, loadMore, post, report, block };
}
