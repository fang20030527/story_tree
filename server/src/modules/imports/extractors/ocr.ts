import { AppError } from '../../../core/errors';
import type { AiProvider, OcrImage } from '../../../infrastructure/ai/types';
import type { ExtractedArticle } from './types';

export async function extractOrderedImageText(
  images: readonly OcrImage[],
  provider: Pick<AiProvider, 'extractArticleText'>,
  signal: AbortSignal,
): Promise<ExtractedArticle> {
  const ordered = [...images].sort(
    (left, right) => left.position - right.position,
  );
  if (
    ordered.length < 1 ||
    ordered.length > 10 ||
    ordered.some((image, index) => image.position !== index)
  ) {
    throw new AppError('IMPORT_CONTENT_INVALID', '图片顺序无效', 422);
  }

  const results: Array<{ title: string | null; text: string }> = [];
  for (let index = 0; index < ordered.length; index += 4) {
    signal.throwIfAborted();
    try {
      results.push(
        await provider.extractArticleText(
          ordered.slice(index, index + 4),
          signal,
        ),
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AppError(
        'IMPORT_OCR_FAILED',
        '图片文字暂时无法识别',
        503,
        true,
      );
    }
  }
  return {
    title: results.find(({ title }) => title)?.title ?? null,
    text: results
      .map(({ text }) => text.trim())
      .filter(Boolean)
      .join('\n\n'),
  };
}
