import { fileTypeFromBuffer } from 'file-type';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { AppError } from '../../../core/errors';
import { countEnglishWords } from '../content';
import { extractReadableHtml } from './html';
import type { ExtractedArticle, ImportAssetInput } from './types';

export type DetectedImportFile =
  | { kind: 'text'; mediaType: 'text/plain' | 'text/markdown' }
  | { kind: 'html'; mediaType: 'text/html' | 'application/xhtml+xml' }
  | { kind: 'pdf'; mediaType: 'application/pdf' }
  | {
      kind: 'docx';
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
  | {
      kind: 'image';
      mediaType:
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp'
        | 'image/gif'
        | 'image/heic'
        | 'image/heif';
    };

const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT_MEDIA_TYPES = new Set(['text/plain', 'text/markdown']);
const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const MAGIC_TYPES = new Map<string, DetectedImportFile>([
  ['application/pdf', { kind: 'pdf', mediaType: 'application/pdf' }],
  [DOCX_MEDIA_TYPE, { kind: 'docx', mediaType: DOCX_MEDIA_TYPE }],
  ['image/jpeg', { kind: 'image', mediaType: 'image/jpeg' }],
  ['image/png', { kind: 'image', mediaType: 'image/png' }],
  ['image/webp', { kind: 'image', mediaType: 'image/webp' }],
  ['image/gif', { kind: 'image', mediaType: 'image/gif' }],
  ['image/heic', { kind: 'image', mediaType: 'image/heic' }],
  ['image/heif', { kind: 'image', mediaType: 'image/heif' }],
]);

export async function detectImportFile(
  content: Buffer,
  declaredMediaType: string,
): Promise<DetectedImportFile> {
  const declared = mediaTypeEssence(declaredMediaType);
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(content);
  } catch {
    throw unsupportedType();
  }
  const magic = detected ? MAGIC_TYPES.get(detected.mime) : undefined;
  if (magic) {
    if (!isCompatibleDeclaration(magic.mediaType, declared)) {
      throw unsupportedType();
    }
    return magic;
  }

  if (
    !TEXT_MEDIA_TYPES.has(declared) &&
    !HTML_MEDIA_TYPES.has(declared) &&
    declared !== 'application/octet-stream'
  ) {
    throw unsupportedType();
  }
  const decoded = decodeUtf8(content);
  if (decoded.includes('\u0000')) throw unsupportedType();
  if (TEXT_MEDIA_TYPES.has(declared)) {
    return {
      kind: 'text',
      mediaType: declared as 'text/plain' | 'text/markdown',
    };
  }
  if (HTML_MEDIA_TYPES.has(declared)) {
    return {
      kind: 'html',
      mediaType: declared as 'text/html' | 'application/xhtml+xml',
    };
  }
  return looksLikeHtml(decoded)
    ? { kind: 'html', mediaType: 'text/html' }
    : { kind: 'text', mediaType: 'text/plain' };
}

export async function extractDocumentAsset(
  asset: ImportAssetInput,
): Promise<ExtractedArticle> {
  const detected = await detectImportFile(asset.content, asset.mediaType);
  try {
    if (detected.kind === 'text') {
      return {
        title: null,
        text: decodeUtf8(asset.content).replace(/^\ufeff/u, ''),
      };
    }
    if (detected.kind === 'html') {
      return extractReadableHtml(
        decodeUtf8(asset.content),
        'https://local-file.invalid/',
      );
    }
    if (detected.kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer: asset.content });
      return { title: null, text: result.value };
    }
    if (detected.kind === 'pdf') {
      const parser = new PDFParse({ data: new Uint8Array(asset.content) });
      try {
        const result = await parser.getText();
        if (countEnglishWords(result.text) < 20) {
          throw new AppError(
            'IMPORT_PARSE_FAILED',
            '该 PDF 没有可提取的英文正文，请将页面导出为图片后从相册导入',
            422,
          );
        }
        return { title: null, text: result.text };
      } finally {
        await parser.destroy();
      }
    }
    throw new AppError('IMPORT_UNSUPPORTED_TYPE', '该图片需要通过 OCR 导入', 422);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('IMPORT_PARSE_FAILED', '文件无法解析', 422);
  }
}

function mediaTypeEssence(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function isCompatibleDeclaration(
  detected: DetectedImportFile['mediaType'],
  declared: string,
): boolean {
  if (declared === 'application/octet-stream' || declared === detected) {
    return true;
  }
  return (
    (detected === 'image/heic' || detected === 'image/heif') &&
    (declared === 'image/heic' || declared === 'image/heif')
  );
}

function decodeUtf8(content: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new AppError('IMPORT_PARSE_FAILED', '文件无法解析', 422);
  }
}

function looksLikeHtml(value: string): boolean {
  return /<(?:!doctype\s+html|html|body|article)(?:\s|>)/iu.test(
    value.slice(0, 1_024),
  );
}

function unsupportedType(): AppError {
  return new AppError('IMPORT_UNSUPPORTED_TYPE', '不支持该文件类型', 422);
}
