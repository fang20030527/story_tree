import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import {
  ArticleImportSourceKindSchema,
  UuidSchema,
} from '@context-reader/contracts';

import { RECENT_VIEWS_KEY } from '@/api/storage';
import { getEditorialArticle } from '@/features/editorial/catalog';
import { isRemoteEditorialId } from '@/features/editorial/remoteCatalog';

const RECENT_VIEWS_LIMIT = 50;

const ImportedRecentViewSchema = z
  .object({
    kind: z.literal('imported'),
    articleId: UuidSchema,
    title: z.string().min(1).max(160),
    sourceKind: ArticleImportSourceKindSchema,
    wordCount: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
  })
  .strict();

const EditorialRecentViewSchema = z
  .object({
    kind: z.literal('editorial'),
    articleId: z.string().min(1).max(64),
    timestamp: z.iso.datetime(),
  })
  .strict();

const RecentViewSchema = z.discriminatedUnion('kind', [
  ImportedRecentViewSchema,
  EditorialRecentViewSchema,
]);
const LegacyRecentViewSchema = ImportedRecentViewSchema.omit({ kind: true });

export type RecentView = z.infer<typeof RecentViewSchema>;
type ImportedRecentView = z.infer<typeof ImportedRecentViewSchema>;

const recentKey = (entry: Pick<RecentView, 'kind' | 'articleId'>) =>
  `${entry.kind}:${entry.articleId}`;

function normalizeRecentViews(value: unknown): RecentView[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .flatMap((candidate): RecentView[] => {
      const current = RecentViewSchema.safeParse(candidate);
      if (current.success) return [current.data];
      const legacy = LegacyRecentViewSchema.safeParse(candidate);
      return legacy.success ? [{ kind: 'imported', ...legacy.data }] : [];
    })
    .filter(
      (entry) =>
        entry.kind === 'imported' || Boolean(getEditorialArticle(entry.articleId))
          || isRemoteEditorialId(entry.articleId),
    );
  entries.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = recentKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, RECENT_VIEWS_LIMIT);
}

async function saveRecentViews(entries: RecentView[]): Promise<void> {
  await AsyncStorage.setItem(
    RECENT_VIEWS_KEY,
    JSON.stringify(entries.map((entry) => RecentViewSchema.parse(entry))),
  );
}

export async function loadRecentViews(): Promise<RecentView[]> {
  const raw = await AsyncStorage.getItem(RECENT_VIEWS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = normalizeRecentViews(parsed);
    if (JSON.stringify(entries) !== JSON.stringify(parsed)) {
      await saveRecentViews(entries);
    }
    return entries;
  } catch {
    return [];
  }
}

async function recordRecentView(entry: RecentView): Promise<void> {
  const entries = await loadRecentViews();
  const key = recentKey(entry);
  await saveRecentViews(
    [entry, ...entries.filter((candidate) => recentKey(candidate) !== key)].slice(
      0,
      RECENT_VIEWS_LIMIT,
    ),
  );
}

export function recordImportedRecentView(
  input: Omit<ImportedRecentView, 'kind' | 'timestamp'>,
): Promise<void> {
  return recordRecentView(
    ImportedRecentViewSchema.parse({
      kind: 'imported',
      ...input,
      timestamp: new Date().toISOString(),
    }),
  );
}

export function recordEditorialRecentView(articleId: string): Promise<void> {
  if (!getEditorialArticle(articleId) && !isRemoteEditorialId(articleId)) {
    return Promise.reject(new Error(`Unknown editorial article: ${articleId}`));
  }
  return recordRecentView(
    EditorialRecentViewSchema.parse({
      kind: 'editorial',
      articleId,
      timestamp: new Date().toISOString(),
    }),
  );
}

export function clearRecentViews(): Promise<void> {
  return AsyncStorage.removeItem(RECENT_VIEWS_KEY);
}

export async function removeRecentView(key: string): Promise<void> {
  const entries = await loadRecentViews();
  await saveRecentViews(
    entries.filter((entry) => recentKey(entry) !== key),
  );
}
