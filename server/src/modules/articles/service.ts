import {
  ImportedArticleDtoSchema,
  ImportedArticlePageSchema,
  UuidSchema,
  type ImportedArticleDto,
  type ImportedArticlePage,
} from '@context-reader/contracts';
import { and, asc, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { articleParagraphs, importedArticles } from '../../db/schema';

export async function getArticleForUser(
  db: AppDatabase,
  input: { userId: string; articleId: string },
): Promise<ImportedArticleDto> {
  const [article] = await db
    .select()
    .from(importedArticles)
    .where(
      and(
        eq(importedArticles.id, input.articleId),
        eq(importedArticles.userId, input.userId),
      ),
    )
    .limit(1);
  if (!article) {
    throw new AppError('NOT_FOUND', '文章不存在', 404);
  }

  const paragraphs = await db
    .select()
    .from(articleParagraphs)
    .where(eq(articleParagraphs.articleId, article.id))
    .orderBy(asc(articleParagraphs.position));
  if (paragraphs.length === 0) {
    throw new AppError('INTERNAL_ERROR', '文章正文暂时无法读取', 500, true);
  }

  return ImportedArticleDtoSchema.parse({
    id: article.id,
    sourceKind: article.sourceKind,
    sourceUrl: article.sourceUrl,
    title: article.title,
    wordCount: article.wordCount,
    importedAt: article.importedAt.toISOString(),
    paragraphs: paragraphs.map((paragraph) => ({
      id: paragraph.id,
      position: paragraph.position,
      text: paragraph.plainText,
    })),
  });
}

const ARTICLE_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MAX_ARTICLE_CURSOR_LENGTH = 512;

const ArticleCursorSchema = z
  .object({ createdAt: z.iso.datetime(), id: UuidSchema })
  .strict();

type ArticleCursor = z.infer<typeof ArticleCursorSchema>;

function invalidArticleCursor(): AppError {
  return new AppError('VALIDATION_ERROR', '文章游标格式无效', 400);
}

function encodeArticleCursor(cursor: ArticleCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeArticleCursor(raw: string): ArticleCursor {
  if (raw.length === 0 || raw.length > MAX_ARTICLE_CURSOR_LENGTH) {
    throw invalidArticleCursor();
  }
  if (!ARTICLE_CURSOR_PATTERN.test(raw)) {
    throw invalidArticleCursor();
  }
  const encoded = Buffer.from(raw, 'base64url').toString('base64url');
  if (encoded !== raw) {
    throw invalidArticleCursor();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidArticleCursor();
  }
  const result = ArticleCursorSchema.safeParse(parsed);
  if (!result.success) {
    throw invalidArticleCursor();
  }
  return result.data;
}

export async function listArticlesForUser(
  db: AppDatabase,
  input: { userId: string; cursor: string | null; limit: number },
): Promise<ImportedArticlePage> {
  const filters: SQL[] = [eq(importedArticles.userId, input.userId)];
  if (input.cursor !== null) {
    const cursor = decodeArticleCursor(input.cursor);
    filters.push(
      or(
        lt(importedArticles.createdAt, new Date(cursor.createdAt)),
        and(
          sql`${importedArticles.createdAt} = to_char(${cursor.createdAt}::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::timestamptz`,
          lt(importedArticles.id, cursor.id),
        ),
      ) ?? sql`false`,
    );
  }

  const rows = await db
    .select()
    .from(importedArticles)
    .where(and(...filters))
    .orderBy(desc(importedArticles.createdAt), desc(importedArticles.id))
    .limit(input.limit + 1);

  const pageRows = rows.slice(0, input.limit);
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > input.limit && lastRow
      ? encodeArticleCursor({
          createdAt: lastRow.createdAt.toISOString(),
          id: lastRow.id,
        })
      : null;

  return ImportedArticlePageSchema.parse({
    items: pageRows.map((article) => ({
      id: article.id,
      sourceKind: article.sourceKind,
      sourceUrl: article.sourceUrl,
      title: article.title,
      wordCount: article.wordCount,
      importedAt: article.importedAt.toISOString(),
    })),
    nextCursor,
  });
}
