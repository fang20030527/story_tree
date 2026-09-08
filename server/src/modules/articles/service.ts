import {
  ImportedArticleDtoSchema,
  type ImportedArticleDto,
} from '@context-reader/contracts';
import { and, asc, eq } from 'drizzle-orm';

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
