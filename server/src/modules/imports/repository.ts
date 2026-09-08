import { and, desc, eq, gte, lte } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { articleImports, importedArticles } from '../../db/schema';
import { hammingDistance64, isSimilarContent } from './content';

export type ArticleImportRow = typeof articleImports.$inferSelect;

export type DuplicateMatch =
  | { kind: 'none' }
  | {
      kind: 'exact';
      article: { id: string; title: string; wordCount: number };
    }
  | {
      kind: 'similar';
      article: {
        id: string;
        title: string;
        wordCount: number;
        hammingDistance: number;
      };
    };

export async function lockOwnedImport(
  tx: AppTransaction,
  userId: string,
  importId: string,
): Promise<ArticleImportRow> {
  const [row] = await tx
    .select()
    .from(articleImports)
    .where(
      and(eq(articleImports.id, importId), eq(articleImports.userId, userId)),
    )
    .limit(1)
    .for('update');
  if (!row) {
    throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  }
  return row;
}

export async function findOwnedImport(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  importId: string,
): Promise<ArticleImportRow> {
  const [row] = await db
    .select()
    .from(articleImports)
    .where(
      and(eq(articleImports.id, importId), eq(articleImports.userId, userId)),
    )
    .limit(1);
  if (!row) {
    throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  }
  return row;
}

export async function findDuplicateForUser(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  identity: { contentHash: string; fingerprint: bigint; wordCount: number },
): Promise<DuplicateMatch> {
  const [exact] = await db
    .select({
      id: importedArticles.id,
      title: importedArticles.title,
      wordCount: importedArticles.wordCount,
    })
    .from(importedArticles)
    .where(
      and(
        eq(importedArticles.userId, userId),
        eq(importedArticles.contentHash, identity.contentHash),
      ),
    )
    .limit(1);
  if (exact) {
    return { kind: 'exact', article: exact };
  }

  const minimumWords = Math.ceil(identity.wordCount / 1.25);
  const maximumWords = Math.floor(identity.wordCount / 0.8);
  const candidates = await db
    .select({
      id: importedArticles.id,
      title: importedArticles.title,
      wordCount: importedArticles.wordCount,
      fingerprint: importedArticles.similarityFingerprint,
    })
    .from(importedArticles)
    .where(
      and(
        eq(importedArticles.userId, userId),
        gte(importedArticles.wordCount, minimumWords),
        lte(importedArticles.wordCount, maximumWords),
      ),
    )
    .orderBy(desc(importedArticles.createdAt), desc(importedArticles.id))
    .limit(500);

  let nearest:
    | (typeof candidates)[number] & { hammingDistance: number }
    | undefined;
  for (const candidate of candidates) {
    if (
      !isSimilarContent(
        { fingerprint: identity.fingerprint, wordCount: identity.wordCount },
        {
          fingerprint: candidate.fingerprint,
          wordCount: candidate.wordCount,
        },
      )
    ) {
      continue;
    }
    const hammingDistance = hammingDistance64(
      identity.fingerprint,
      candidate.fingerprint,
    );
    if (!nearest || hammingDistance < nearest.hammingDistance) {
      nearest = { ...candidate, hammingDistance };
    }
  }

  if (!nearest) {
    return { kind: 'none' };
  }
  return {
    kind: 'similar',
    article: {
      id: nearest.id,
      title: nearest.title,
      wordCount: nearest.wordCount,
      hammingDistance: nearest.hammingDistance,
    },
  };
}
