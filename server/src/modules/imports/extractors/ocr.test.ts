import { describe, expect, it, vi } from 'vitest';

import type { OcrImage } from '../../../infrastructure/ai/types';
import { extractOrderedImageText } from './ocr';

describe('ordered image OCR batching', () => {
  it('sorts ten images into ordered batches of at most four', async () => {
    const extractArticleText = vi.fn(
      async (images: readonly OcrImage[]) => ({
        title: images[0]?.position === 0 ? 'Synthetic OCR article' : null,
        text: images.map(({ position }) => `Original position ${position}.`).join(' '),
      }),
    );
    const images = Array.from({ length: 10 }, (_, position) => image(position))
      .reverse();
    const result = await extractOrderedImageText(
      images,
      { extractArticleText },
      new AbortController().signal,
    );
    expect(extractArticleText).toHaveBeenCalledTimes(3);
    expect(
      extractArticleText.mock.calls.map(([batch]) =>
        batch.map(({ position }) => position),
      ),
    ).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
    expect(result.title).toBe('Synthetic OCR article');
    expect(result.text.indexOf('position 0')).toBeLessThan(
      result.text.indexOf('position 9'),
    );
  });

  it.each([
    { images: [image(-1)] },
    { images: [image(0), image(0)] },
    { images: [image(0), image(2)] },
    { images: [] },
  ])('rejects invalid positions before calling the provider', async ({ images }) => {
    const extractArticleText = vi.fn();
    await expect(
      extractOrderedImageText(
        images,
        { extractArticleText },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_CONTENT_INVALID' });
    expect(extractArticleText).not.toHaveBeenCalled();
  });

  it('stops before a later batch when the caller aborts', async () => {
    const controller = new AbortController();
    const extractArticleText = vi.fn(async () => {
      controller.abort();
      return { title: null, text: 'Original first batch.' };
    });
    await expect(
      extractOrderedImageText(
        Array.from({ length: 5 }, (_, position) => image(position)),
        { extractArticleText },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(extractArticleText).toHaveBeenCalledOnce();
  });
});

function image(position: number): OcrImage {
  return {
    position,
    mediaType: 'image/jpeg',
    base64: Buffer.from(`synthetic-${position}`).toString('base64'),
  };
}
