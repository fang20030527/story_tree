import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import {
  ArticleImportSourceKindSchema,
  UuidSchema,
  type ArticleImportSourceKind,
} from '@context-reader/contracts';

import { FAVORITES_KEY, RECENT_VIEWS_KEY } from '@/api/storage';

const RECENT_VIEWS_LIMIT = 50;

export const LibraryEntrySchema = z
  .object({
    articleId: UuidSchema,
    title: z.string().min(1).max(160),
    sourceKind: ArticleImportSourceKindSchema,
    wordCount: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
  })
  .strict();

export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

const LibraryEntryListSchema = z.array(LibraryEntrySchema).max(500);

async function loadEntries(storageKey: string): Promise<LibraryEntry[]> {
  const value = await AsyncStorage.getItem(storageKey);
  if (!value) return [];
  try {
    const parsed = LibraryEntryListSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function saveEntries(
  storageKey: string,
  entries: LibraryEntry[],
): Promise<void> {
  return AsyncStorage.setItem(
    storageKey,
    JSON.stringify(LibraryEntryListSchema.parse(entries)),
  );
}

export async function recordRecentView(input: {
  articleId: string;
  title: string;
  sourceKind: ArticleImportSourceKind;
  wordCount: number;
}): Promise<void> {
  const entry = LibraryEntrySchema.parse({
    ...input,
    timestamp: new Date().toISOString(),
  });
  const entries = await loadEntries(RECENT_VIEWS_KEY);
  const next = [
    entry,
    ...entries.filter((item) => item.articleId !== entry.articleId),
  ].slice(0, RECENT_VIEWS_LIMIT);
  await saveEntries(RECENT_VIEWS_KEY, next);
}

export function loadRecentViews(): Promise<LibraryEntry[]> {
  return loadEntries(RECENT_VIEWS_KEY);
}

export function clearRecentViews(): Promise<void> {
  return AsyncStorage.removeItem(RECENT_VIEWS_KEY);
}

export async function removeRecentView(articleId: string): Promise<void> {
  const id = UuidSchema.parse(articleId);
  const entries = await loadEntries(RECENT_VIEWS_KEY);
  await saveEntries(
    RECENT_VIEWS_KEY,
    entries.filter((item) => item.articleId !== id),
  );
}

export function loadFavorites(): Promise<LibraryEntry[]> {
  return loadEntries(FAVORITES_KEY);
}

export async function isFavorite(articleId: string): Promise<boolean> {
  const entries = await loadEntries(FAVORITES_KEY);
  return entries.some((item) => item.articleId === articleId);
}

/** Returns the new favorite state after toggling. */
export async function toggleFavorite(input: {
  articleId: string;
  title: string;
  sourceKind: ArticleImportSourceKind;
  wordCount: number;
}): Promise<boolean> {
  const id = UuidSchema.parse(input.articleId);
  const entries = await loadEntries(FAVORITES_KEY);
  const existing = entries.find((item) => item.articleId === id);
  if (existing) {
    await saveEntries(
      FAVORITES_KEY,
      entries.filter((item) => item.articleId !== id),
    );
    return false;
  }
  const entry = LibraryEntrySchema.parse({
    ...input,
    timestamp: new Date().toISOString(),
  });
  await saveEntries(FAVORITES_KEY, [entry, ...entries]);
  return true;
}

export async function removeFavorite(articleId: string): Promise<void> {
  const id = UuidSchema.parse(articleId);
  const entries = await loadEntries(FAVORITES_KEY);
  await saveEntries(
    FAVORITES_KEY,
    entries.filter((item) => item.articleId !== id),
  );
}

export function clearFavorites(): Promise<void> {
  return AsyncStorage.removeItem(FAVORITES_KEY);
}
