import { ImportedArticleMediaSchema, type ImportedArticleMedia } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';

const StoredMediaSchema = ImportedArticleMediaSchema.array().max(100);

export function parseStoredMedia(value: string | null): ImportedArticleMedia[] {
  if (value === null) return [];
  try {
    return StoredMediaSchema.parse(JSON.parse(value));
  } catch {
    throw new AppError('INTERNAL_ERROR', '文章媒体暂时无法读取', 500, true);
  }
}
