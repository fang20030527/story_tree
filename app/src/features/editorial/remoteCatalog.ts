import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PublishedEditorialCatalogSchema,
  PublishedEditorialIdSchema,
  type PublishedEditorialArticle,
  type PublishedEditorialSummary,
} from '@context-reader/contracts';
import { useSyncExternalStore } from 'react';

import {
  getPublishedEditorialArticle,
  listPublishedEditorialArticles,
} from '@/api/editorial';
import { EDITORIAL_CATALOG_CACHE_KEY } from '@/api/storage';

let summaries: readonly PublishedEditorialSummary[] = [];
let featuredArticleId: string | undefined;
const details = new Map<string, PublishedEditorialArticle>();
const requests = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let revision = 0;
let hydratePromise: Promise<void> | undefined;
let refreshPromise: Promise<void> | undefined;

function notify(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function isRemoteEditorialId(id: string): boolean {
  return PublishedEditorialIdSchema.safeParse(id).success;
}

export function getRemoteEditorialSummaries(): readonly PublishedEditorialSummary[] {
  return summaries;
}

export function getRemoteFeaturedArticleId(): string | undefined {
  return featuredArticleId;
}

export function getRemoteEditorialDetail(id: string): PublishedEditorialArticle | undefined {
  return details.get(id);
}

export function useRemoteEditorialCatalogVersion(): number {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => revision,
    () => revision,
  );
}

export function hydrateRemoteEditorialCatalog(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = AsyncStorage.getItem(EDITORIAL_CATALOG_CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        const cached = PublishedEditorialCatalogSchema.safeParse(JSON.parse(raw) as unknown);
        if (cached.success) {
          summaries = cached.data.articles;
          featuredArticleId = cached.data.featuredArticleId;
          notify();
        }
      })
      .catch(() => undefined);
  }
  return hydratePromise;
}

export async function refreshRemoteEditorialCatalog(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    await hydrateRemoteEditorialCatalog();
    const catalog = await listPublishedEditorialArticles();
    summaries = catalog.articles;
    featuredArticleId = catalog.featuredArticleId;
    const currentIds = new Set(summaries.map((article) => article.id));
    for (const id of details.keys()) if (!currentIds.has(id)) details.delete(id);
    notify();
    await AsyncStorage.setItem(EDITORIAL_CATALOG_CACHE_KEY, JSON.stringify(catalog))
      .catch(() => undefined);
  })();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = undefined;
  }
}

export function refreshRemoteEditorialDetail(id: string): Promise<void> {
  const pending = requests.get(id);
  if (pending) return pending;
  const request = getPublishedEditorialArticle(id)
    .then((article) => {
      details.set(id, article);
      notify();
    })
    .finally(() => { requests.delete(id); });
  requests.set(id, request);
  return request;
}
