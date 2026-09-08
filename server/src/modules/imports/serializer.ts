import {
  ArticleImportDtoSchema,
  type ArticleImportDto,
} from '@context-reader/contracts';

import type { ArticleImportRow, DuplicateMatch } from './repository';

export function serializeArticleImport(
  row: ArticleImportRow,
  duplicate: DuplicateMatch = { kind: 'none' },
): ArticleImportDto {
  const polling =
    row.status === 'awaiting_upload' ||
    row.status === 'queued' ||
    row.status === 'processing';
  const failed = row.status === 'retryable' || row.status === 'failed';

  return ArticleImportDtoSchema.parse({
    id: row.id,
    sourceKind: row.sourceKind,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    ...(polling ? { pollAfterMs: 1_500 } : {}),
    failure: failed
      ? {
          code: row.failureCode,
          message: row.failureMessagePublic,
          retryable: row.status === 'retryable',
        }
      : null,
    preview:
      row.status === 'preview_ready'
        ? {
            title: row.previewTitle,
            text: row.previewText,
            wordCount: row.wordCount,
            duplicate,
          }
        : null,
    articleId: row.status === 'confirmed' ? row.articleId : null,
  });
}
