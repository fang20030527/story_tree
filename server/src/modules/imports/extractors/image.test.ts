import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { normalizeImageAsset } from './image';

describe('bounded image normalization', () => {
  it('orients, bounds, and strips metadata from opaque images', async () => {
    const large = await sharp({
      create: {
        width: 3_000,
        height: 1_500,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const normalized = await normalizeImageAsset({
      position: 3,
      mediaType: 'image/jpeg',
      content: large,
    });
    expect(normalized.position).toBe(3);
    expect(normalized.mediaType).toBe('image/jpeg');
    const metadata = await sharp(
      Buffer.from(normalized.base64, 'base64'),
    ).metadata();
    expect(Math.max(metadata.width!, metadata.height!)).toBe(2_048);
    expect(metadata.width).toBeLessThan(metadata.height!);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it('keeps alpha as PNG and emits opaque PNG input as JPEG', async () => {
    const transparent = await sharp({
      create: {
        width: 24,
        height: 12,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const opaque = await sharp({
      create: {
        width: 24,
        height: 12,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();
    await expect(
      normalizeImageAsset({ position: 0, mediaType: 'image/png', content: transparent }),
    ).resolves.toMatchObject({ mediaType: 'image/png' });
    await expect(
      normalizeImageAsset({ position: 0, mediaType: 'image/png', content: opaque }),
    ).resolves.toMatchObject({ mediaType: 'image/jpeg' });
  });

  it('uses only the first frame of animated GIF and WebP input', async () => {
    const firstFrame = await sharp({
      create: {
        width: 24,
        height: 12,
        channels: 3,
        background: '#123456',
      },
    })
      .png()
      .toBuffer();
    const secondFrame = await sharp({
      create: {
        width: 8,
        height: 4,
        channels: 3,
        background: '#654321',
      },
    })
      .resize(24, 12)
      .png()
      .toBuffer();
    const gif = await sharp([firstFrame, secondFrame], {
      join: { animated: true },
    })
      .gif()
      .toBuffer();
    const animatedWebp = await sharp([firstFrame, secondFrame], {
      join: { animated: true },
    })
      .webp()
      .toBuffer();
    expect((await sharp(gif).metadata()).pages).toBe(2);
    expect((await sharp(animatedWebp).metadata()).pages).toBe(2);
    for (const [mediaType, content] of [
      ['image/gif', gif],
      ['image/webp', animatedWebp],
    ] as const) {
      const normalized = await normalizeImageAsset({
        position: 1,
        mediaType,
        content,
      });
      expect(normalized.position).toBe(1);
      const output = await sharp(
        Buffer.from(normalized.base64, 'base64'),
      ).metadata();
      expect(output.width).toBe(24);
      expect(output.height).toBe(12);
      expect(output.pages).toBeUndefined();
    }
  });

  it('converts HEIC once and then applies the same Sharp pipeline', async () => {
    const decoded = await sharp({
      create: {
        width: 16,
        height: 8,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .toBuffer();
    const convertHeic = vi.fn().mockResolvedValue(decoded);
    const normalized = await normalizeImageAsset(
      {
        position: 0,
        mediaType: 'image/heic',
        content: Buffer.from('synthetic-heic-placeholder'),
      },
      { convertHeic },
    );
    expect(convertHeic).toHaveBeenCalledOnce();
    expect(normalized.mediaType).toBe('image/jpeg');
  });

  it('rejects corrupt image input without parser details', async () => {
    await expect(
      normalizeImageAsset({
        position: 0,
        mediaType: 'image/jpeg',
        content: Buffer.from('not-an-image'),
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED', retryable: false });
  });

  it('rejects oversized pixel dimensions without decoding the full image', async () => {
    const huge = await sharp({
      create: {
        width: 12_000,
        height: 12_000,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();
    await expect(
      normalizeImageAsset({
        position: 0,
        mediaType: 'image/png',
        content: huge,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED', retryable: false });
  });
});
