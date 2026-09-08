import convertHeic from 'heic-convert';
import sharp from 'sharp';

import { AppError } from '../../../core/errors';
import type { OcrImage } from '../../../infrastructure/ai/types';
import type { ImportAssetInput } from './types';

export async function normalizeImageAsset(
  asset: ImportAssetInput,
  dependencies: { convertHeic?: typeof convertHeic } = {},
): Promise<OcrImage> {
  try {
    const heic =
      asset.mediaType === 'image/heic' || asset.mediaType === 'image/heif';
    const decoded = heic
      ? await (dependencies.convertHeic ?? convertHeic)({
          buffer: asset.content,
          format: 'JPEG',
          quality: 1,
        })
      : asset.content;
    const options = {
      page: 0,
      pages: 1,
      limitInputPixels: 50_000_000,
      sequentialRead: true,
    } as const;
    const metadata = await sharp(decoded, options).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Missing dimensions');
    }
    const pipeline = sharp(decoded, options).rotate().resize({
      width: 2_048,
      height: 2_048,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const transparent = metadata.hasAlpha === true;
    const output = transparent
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
      : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return {
      mediaType: transparent ? 'image/png' : 'image/jpeg',
      base64: output.toString('base64'),
      position: asset.position,
    };
  } catch {
    throw new AppError('IMPORT_PARSE_FAILED', '图片无法解码', 422);
  }
}
