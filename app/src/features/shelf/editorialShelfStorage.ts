import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { EDITORIAL_SHELF_KEY } from '@/api/storage';
import { getEditorialArticle } from '@/features/editorial/catalog';

const EditorialShelfEntrySchema = z
  .object({
    articleId: z.string().min(1).max(64),
    addedAt: z.iso.datetime(),
  })
  .strict();

export type EditorialShelfEntry = z.infer<typeof EditorialShelfEntrySchema>;

function normalizeEntries(value: unknown): EditorialShelfEntry[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((candidate) => {
    const result = EditorialShelfEntrySchema.safeParse(candidate);
    return result.success && getEditorialArticle(result.data.articleId)
      ? [result.data]
      : [];
  });
  parsed.sort((left, right) => right.addedAt.localeCompare(left.addedAt));

  const seen = new Set<string>();
  return parsed.filter(({ articleId }) => {
    if (seen.has(articleId)) return false;
    seen.add(articleId);
    return true;
  });
}

export async function loadEditorialShelf(): Promise<EditorialShelfEntry[]> {
  const raw = await AsyncStorage.getItem(EDITORIAL_SHELF_KEY);
  if (!raw) return [];
  try {
    return normalizeEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function saveEditorialShelf(
  entries: EditorialShelfEntry[],
): Promise<void> {
  await AsyncStorage.setItem(
    EDITORIAL_SHELF_KEY,
    JSON.stringify(
      entries.map((entry) => EditorialShelfEntrySchema.parse(entry)),
    ),
  );
}

function assertCatalogArticle(articleId: string): void {
  if (!getEditorialArticle(articleId)) {
    throw new Error(`Unknown editorial article: ${articleId}`);
  }
}

export async function isEditorialArticleShelved(
  articleId: string,
): Promise<boolean> {
  assertCatalogArticle(articleId);
  return (await loadEditorialShelf()).some(
    (entry) => entry.articleId === articleId,
  );
}

export async function setEditorialArticleShelved(
  articleId: string,
  shelved: boolean,
): Promise<void> {
  assertCatalogArticle(articleId);
  const entries = await loadEditorialShelf();
  const existing = entries.find((entry) => entry.articleId === articleId);
  if ((existing && shelved) || (!existing && !shelved)) return;
  await saveEditorialShelf(
    shelved
      ? [{ articleId, addedAt: new Date().toISOString() }, ...entries]
      : entries.filter((entry) => entry.articleId !== articleId),
  );
}
