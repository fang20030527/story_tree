/** Worker-safe import conversion. No database or Node image/document parsers. */

const MAX_ASSET_BYTES = 10_485_760;
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_IMAGE_EDGE = 2_048;
const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT_MEDIA_TYPES = new Set(['text/plain', 'text/markdown']);
const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const ENGLISH_WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/gu;

export interface ImportAssetInput {
  position: number;
  mediaType: string;
  content: Uint8Array;
}

export interface ExtractedArticle {
  title: string | null;
  text: string;
}

export interface OcrImage {
  position: number;
  mediaType: 'image/jpeg' | 'image/png';
  base64: string;
}

export type DetectedImportFile =
  | { kind: 'text'; mediaType: 'text/plain' | 'text/markdown' }
  | { kind: 'html'; mediaType: 'text/html' | 'application/xhtml+xml' }
  | { kind: 'pdf'; mediaType: 'application/pdf' }
  | { kind: 'docx'; mediaType: typeof DOCX_MEDIA_TYPE }
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

export class ImportConversionError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: 'IMPORT_UNSUPPORTED_TYPE' | 'IMPORT_TOO_LARGE' | 'IMPORT_PARSE_FAILED',
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ImportConversionError';
  }
}

interface MarkdownResult {
  format: 'markdown' | 'text' | 'error';
  data?: string;
}

export interface MarkdownBinding {
  toMarkdown(
    file: { name: string; blob: Blob },
    options: {
      conversionOptions: {
        output: { format: 'text' };
        pdf?: { metadata: false };
        html?: { hostname: string };
      };
    },
  ): Promise<MarkdownResult | MarkdownResult[]>;
}

interface ImageTransformer {
  transform(options: {
    width: number;
    height: number;
    fit: 'scale-down';
  }): ImageTransformer;
  output(options: {
    format: 'image/jpeg' | 'image/png';
    quality?: number;
    anim: false;
  }): Promise<{ image(options: { encoding: 'base64' }): ReadableStream<Uint8Array> }>;
}

export interface ImagesBinding {
  info(stream: ReadableStream<Uint8Array>): Promise<
    | { format: 'image/svg+xml' }
    | { format: string; fileSize: number; width: number; height: number }
  >;
  input(stream: ReadableStream<Uint8Array>): ImageTransformer;
}

export async function detectImportFile(
  content: Uint8Array,
  declaredMediaType: string,
): Promise<DetectedImportFile> {
  assertAssetSize(content);
  const declared = mediaTypeEssence(declaredMediaType);
  const magic = detectMagic(content);
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

/** PDF, DOCX and local HTML use Cloudflare's conversion service; text stays local. */
export async function extractDocumentAsset(
  asset: ImportAssetInput,
  bindings: { AI: MarkdownBinding },
): Promise<ExtractedArticle> {
  const detected = await detectImportFile(asset.content, asset.mediaType);
  if (detected.kind === 'text') {
    return {
      title: null,
      text: decodeUtf8(asset.content).replace(/^\ufeff/u, ''),
    };
  }
  if (detected.kind === 'image') {
    throw new ImportConversionError(
      'IMPORT_UNSUPPORTED_TYPE',
      '该图片需要通过 OCR 导入',
      422,
    );
  }

  const mediaType = detected.kind === 'html' ? 'text/html' : detected.mediaType;
  const name =
    detected.kind === 'pdf'
      ? 'document.pdf'
      : detected.kind === 'docx'
        ? 'document.docx'
        : 'document.html';
  try {
    const result = await bindings.AI.toMarkdown(
      {
        name,
        blob: new Blob([new Uint8Array(asset.content)], { type: mediaType }),
      },
      {
        conversionOptions: {
          output: { format: 'text' },
          pdf: { metadata: false },
          html: { hostname: 'local-file.invalid' },
        },
      },
    );
    const converted = Array.isArray(result) ? result[0] : result;
    if (
      !converted ||
      converted.format === 'error' ||
      typeof converted.data !== 'string' ||
      converted.data.trim().length === 0
    ) {
      throw parseFailed('文件无法解析');
    }
    if (detected.kind === 'pdf' && countEnglishWords(converted.data) < 20) {
      throw parseFailed(
        '该 PDF 没有可提取的英文正文，请将页面导出为图片后从相册导入',
      );
    }
    return {
      title: detected.kind === 'html' ? readHtmlTitle(asset.content) : null,
      text: converted.data,
    };
  } catch (error) {
    if (error instanceof ImportConversionError) throw error;
    throw parseFailed('文件无法解析');
  }
}

/** Cloudflare Images decodes, orients and bounds images before EvoLink OCR. */
export async function normalizeImageAsset(
  asset: ImportAssetInput,
  bindings: { IMAGES: ImagesBinding },
): Promise<OcrImage> {
  const detected = await detectImportFile(asset.content, asset.mediaType);
  if (detected.kind !== 'image') throw unsupportedType();
  try {
    const info = await bindings.IMAGES.info(streamBytes(asset.content));
    if (
      !('width' in info) ||
      !Number.isSafeInteger(info.width) ||
      !Number.isSafeInteger(info.height) ||
      info.width <= 0 ||
      info.height <= 0 ||
      info.width * info.height > MAX_IMAGE_PIXELS ||
      !isCompatibleDeclaration(detected.mediaType, info.format)
    ) {
      throw parseFailed('图片无法解码');
    }
    const mediaType = shouldPreserveAlpha(detected.mediaType, asset.content)
      ? 'image/png'
      : 'image/jpeg';
    const transformed = await bindings.IMAGES.input(streamBytes(asset.content))
      .transform({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: 'scale-down',
      })
      .output({
        format: mediaType,
        ...(mediaType === 'image/jpeg' ? { quality: 82 } : {}),
        anim: false,
      });
    // The Images service emits Base64 directly; the Worker avoids CPU-heavy encoding.
    const base64 = await new Response(
      transformed.image({ encoding: 'base64' }),
    ).text();
    if (!base64) throw parseFailed('图片无法解码');
    return { position: asset.position, mediaType, base64 };
  } catch (error) {
    if (error instanceof ImportConversionError) throw error;
    throw parseFailed('图片无法解码');
  }
}

function detectMagic(content: Uint8Array): DetectedImportFile | undefined {
  if (matches(content, 0, '%PDF-')) {
    return { kind: 'pdf', mediaType: 'application/pdf' };
  }
  if (isDocx(content)) {
    return { kind: 'docx', mediaType: DOCX_MEDIA_TYPE };
  }
  if (
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  ) {
    return { kind: 'image', mediaType: 'image/jpeg' };
  }
  if (
    content.length >= 8 &&
    content[0] === 0x89 &&
    matches(content, 1, 'PNG\r\n\u001a\n')
  ) {
    return { kind: 'image', mediaType: 'image/png' };
  }
  if (matches(content, 0, 'GIF87a') || matches(content, 0, 'GIF89a')) {
    return { kind: 'image', mediaType: 'image/gif' };
  }
  if (matches(content, 0, 'RIFF') && matches(content, 8, 'WEBP')) {
    return { kind: 'image', mediaType: 'image/webp' };
  }
  const heif = detectHeif(content);
  return heif ? { kind: 'image', mediaType: heif } : undefined;
}

function isDocx(content: Uint8Array): boolean {
  if (
    content.length < 22 ||
    content[0] !== 0x50 ||
    content[1] !== 0x4b ||
    content[2] !== 0x03 ||
    content[3] !== 0x04
  ) {
    return false;
  }
  // Inspect ZIP's central directory names without inflating any untrusted data.
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  let end = -1;
  for (let offset = content.length - 22; offset >= Math.max(0, content.length - 65_557); offset -= 1) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === content.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) return false;
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (start + size > end) return false;
  let foundDocument = false;
  let foundTypes = false;
  let entries = 0;
  for (let offset = start; offset + 46 <= start + size;) {
    if (++entries > 20_000) return false;
    if (view.getUint32(offset, true) !== 0x02014b50) return false;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > start + size) return false;
    foundDocument ||= matches(content, offset + 46, 'word/document.xml') && nameLength === 17;
    foundTypes ||= matches(content, offset + 46, '[Content_Types].xml') && nameLength === 19;
    offset = next;
  }
  return foundDocument && foundTypes;
}

function detectHeif(content: Uint8Array): 'image/heic' | 'image/heif' | undefined {
  if (content.length < 16 || !matches(content, 4, 'ftyp')) return undefined;
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const boxSize = view.getUint32(0, false);
  if (boxSize < 16 || boxSize > 4_096 || boxSize > content.length) return undefined;
  let heic = false;
  let heif = false;
  for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
    if (offset === 12) continue; // minor version, not a compatible brand
    if (matches(content, offset, 'avif') || matches(content, offset, 'avis')) {
      return undefined;
    }
    heic ||= ['heic', 'heix', 'hevc', 'hevx'].some((brand) =>
      matches(content, offset, brand),
    );
    heif ||= ['heif', 'mif1', 'msf1'].some((brand) =>
      matches(content, offset, brand),
    );
  }
  return heic ? 'image/heic' : heif ? 'image/heif' : undefined;
}

function shouldPreserveAlpha(mediaType: DetectedImportFile['mediaType'], content: Uint8Array): boolean {
  if (mediaType === 'image/png') return pngHasAlpha(content);
  if (mediaType === 'image/webp') return webpHasAlpha(content);
  if (mediaType === 'image/gif') return gifHasAlpha(content);
  return mediaType === 'image/heif';
}

function pngHasAlpha(content: Uint8Array): boolean {
  if (content.length < 26) return true;
  const colorType = content[25];
  if (colorType === 4 || colorType === 6) return true;
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  for (let offset = 8; offset + 12 <= Math.min(content.length, 262_144);) {
    const length = view.getUint32(offset, false);
    if (length > content.length - offset - 12) return true;
    if (matches(content, offset + 4, 'tRNS')) return true;
    if (matches(content, offset + 4, 'IDAT')) return false;
    offset += length + 12;
  }
  return true;
}

function webpHasAlpha(content: Uint8Array): boolean {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  for (let offset = 12; offset + 8 <= Math.min(content.length, 65_536);) {
    const length = view.getUint32(offset + 4, true);
    if (length > content.length - offset - 8) return true;
    if (matches(content, offset, 'ALPH')) return true;
    if (matches(content, offset, 'VP8X') && length >= 1) {
      return ((content[offset + 8] ?? 0) & 0x10) !== 0;
    }
    if (matches(content, offset, 'VP8L') && length >= 5) {
      return ((content[offset + 12] ?? 0) & 0x10) !== 0;
    }
    offset += 8 + length + (length & 1);
  }
  return true;
}

function gifHasAlpha(content: Uint8Array): boolean {
  if (content.length < 13) return true;
  const packed = content[10] ?? 0;
  let offset = 13 + ((packed & 0x80) ? 3 * (1 << ((packed & 7) + 1)) : 0);
  while (offset + 2 < Math.min(content.length, 65_536)) {
    const marker = content[offset];
    if (marker === 0x2c || marker === 0x3b) return false;
    if (marker !== 0x21) return true;
    if (content[offset + 1] === 0xf9 && content[offset + 2] === 4) {
      return ((content[offset + 3] ?? 0) & 1) !== 0;
    }
    offset += 2;
    while (offset < content.length) {
      const blockSize = content[offset] ?? 0;
      offset += 1 + blockSize;
      if (blockSize === 0) break;
    }
  }
  return true;
}

function streamBytes(content: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(content);
      controller.close();
    },
  });
}

function matches(content: Uint8Array, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > content.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (content[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function mediaTypeEssence(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function isCompatibleDeclaration(detected: string, declared: string): boolean {
  return (
    declared === 'application/octet-stream' ||
    declared === detected ||
    (['image/heic', 'image/heif'].includes(detected) &&
      ['image/heic', 'image/heif'].includes(declared))
  );
}

function decodeUtf8(content: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw parseFailed('文件无法解析');
  }
}

function looksLikeHtml(value: string): boolean {
  return /<(?:!doctype\s+html|html|body|article)(?:\s|>)/iu.test(value.slice(0, 1_024));
}

function countEnglishWords(value: string): number {
  return value.match(ENGLISH_WORD)?.length ?? 0;
}

function readHtmlTitle(content: Uint8Array): string | null {
  const head = new TextDecoder().decode(content.subarray(0, 65_536));
  const raw = /<title\b[^>]*>([^<]{1,512})<\/title\s*>/iu.exec(head)?.[1];
  if (!raw) return null;
  const title = raw
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/giu, (_match, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/giu, (entity) => {
      const named: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&nbsp;': ' ',
      };
      return named[entity.toLowerCase()] ?? entity;
    })
    .replace(/\s+/gu, ' ')
    .trim();
  return title && Array.from(title).length <= 160 ? title : null;
}

function assertAssetSize(content: Uint8Array): void {
  if (content.byteLength > MAX_ASSET_BYTES) {
    throw new ImportConversionError('IMPORT_TOO_LARGE', '上传文件过大', 413);
  }
  if (content.byteLength === 0) throw parseFailed('文件无法解析');
}

function unsupportedType(): ImportConversionError {
  return new ImportConversionError('IMPORT_UNSUPPORTED_TYPE', '不支持该文件类型', 422);
}

function parseFailed(message: string): ImportConversionError {
  return new ImportConversionError('IMPORT_PARSE_FAILED', message, 422);
}
