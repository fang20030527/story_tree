import type { ArticleImportDto } from '@context-reader/contracts';

import { ApiError } from '@/api/client';
import { confirmArticleImport } from '@/api/imports';

import {
  clearActiveImportIdIfMatches,
  clearImportOperationKeys,
  loadOrCreateImportOperationKey,
} from './importStorage';

/**
 * Confirms a ready import without putting an additional review step in front
 * of the reader. Similar imports reuse the existing article so the
 * no-confirmation flow never creates an unexpected duplicate.
 */
export async function autoConfirmArticleImport(
  articleImport: ArticleImportDto,
): Promise<string> {
  if (
    articleImport.status !== 'preview_ready' ||
    !articleImport.preview
  ) {
    throw new ApiError('STATE_CONFLICT', '导入内容还未准备好', true);
  }

  const similarityDecision = articleImport.preview.duplicate.kind === 'similar'
    ? 'open_existing'
    : undefined;
  const key = await loadOrCreateImportOperationKey(articleImport.id, 'confirm');
  const confirmed = await confirmArticleImport(
    articleImport.id,
    similarityDecision ? { similarityDecision } : {},
    key,
  );
  if (confirmed.status !== 'confirmed' || !confirmed.articleId) {
    throw new ApiError(
      'INVALID_SERVER_RESPONSE',
      '服务返回了无法识别的数据',
      true,
    );
  }

  await clearImportOperationKeys(articleImport.id).catch(() => {});
  await clearActiveImportIdIfMatches(articleImport.id).catch(() => {});
  return confirmed.articleId;
}

export function importNeedsAutoConfirmation(
  articleImport: ArticleImportDto | null,
): articleImport is ArticleImportDto & {
  status: 'preview_ready';
  preview: NonNullable<ArticleImportDto['preview']>;
} {
  return Boolean(
    articleImport?.status === 'preview_ready' && articleImport.preview,
  );
}
