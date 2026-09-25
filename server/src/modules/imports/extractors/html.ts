import { ImportedMediaUrlSchema, type ImportedArticleMedia } from '@context-reader/contracts';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { AppError } from '../../../core/errors';
import type { ExtractedArticle } from './types';

const READABLE_BLOCK_SELECTOR = [
  'article', 'section', 'div', 'p', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'li', 'figcaption',
].join(',');
const ORDERED_SELECTOR = `${READABLE_BLOCK_SELECTOR},figure,img`;

export function extractReadableHtml(html: string, sourceUrl: string): ExtractedArticle {
  const { document } = parseHTML(html);
  const source = new URL(sourceUrl);
  if (
    (source.hostname === 'eudic.net' || source.hostname.endsWith('.eudic.net')) &&
    (/^\/courses\/(?:detail|index)(?:\/|$)/iu.test(source.pathname) ||
      /^\/account\/login(?:\/|$)/iu.test(source.pathname))
  ) {
    throw new AppError(
      'IMPORT_SOURCE_REQUIRES_ACCESS',
      '分享链接未提供公开正文，请在原 App 中复制英文正文或截图导入',
      422,
    );
  }

  const videoThumbnail = readVideoThumbnail(document, sourceUrl);
  const originalVideos = Array.from(document.querySelectorAll(
    'article [data-component*="video"],article video,article iframe[src],main [data-component*="video"],main video,main iframe[src]',
  )).filter((element) => !element.parentElement?.closest(
    '[data-component*="video"],video,iframe',
  ));
  const sanitizedDocument = document.cloneNode(true) as Document;
  for (const element of sanitizedDocument.querySelectorAll(
    'script,style,noscript,template,iframe,object,embed',
  )) {
    element.remove();
  }
  const base = sanitizedDocument.createElement('base');
  base.setAttribute('href', sourceUrl);
  sanitizedDocument.head.prepend(base);
  const parsed = new Readability(sanitizedDocument as ConstructorParameters<typeof Readability>[0], {
    charThreshold: 20,
    maxElemsToParse: 50_000,
    disableJSONLD: false,
  }).parse();
  const extracted = parsed ? extractOrderedContent(parsed.content ?? '', sourceUrl) : null;
  const text = extracted?.paragraphs.length
    ? extracted.paragraphs.join('\n\n')
    : normalizeBlockText(parsed?.textContent ?? '');
  if (!text) {
    throw new AppError('IMPORT_PARSE_FAILED', '未能从网页中提取正文，请粘贴正文', 422);
  }
  const paragraphs = extracted?.paragraphs ?? text.split('\n\n');
  const media = extracted?.media ?? [];
  for (const element of originalVideos) {
    const video = videoFromElement(element, sourceUrl, videoThumbnail);
    if (!video) continue;
    const nextParagraph = findNextReadableParagraph(element, paragraphs);
    const captionPosition = video.caption
      ? paragraphs.findIndex((text, index) => text === video.caption &&
        (nextParagraph === null || index < nextParagraph))
      : -1;
    video.afterParagraph = captionPosition >= 0
      ? captionPosition - 1
      : nextParagraph === null ? paragraphs.length - 1 : nextParagraph - 1;
    if (captionPosition >= 0) video.captionParagraphPositions = [captionPosition];
    if (!media.some((item) => item.type === 'video' && item.url === video.url &&
      item.afterParagraph === video.afterParagraph)) {
      media.push(video);
    }
  }
  media.sort((a, b) => a.afterParagraph - b.afterParagraph);
  return { title: parsed?.title?.trim() || null, text, media: media.slice(0, 100) };
}

function extractOrderedContent(content: string, sourceUrl: string): {
  paragraphs: string[];
  media: ImportedArticleMedia[];
} {
  const { document } = parseHTML(content);
  const paragraphs: string[] = [];
  const media: ImportedArticleMedia[] = [];
  for (const element of document.querySelectorAll(ORDERED_SELECTOR)) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'figure' || tag === 'img') {
      if (tag === 'img' && element.closest('figure')) continue;
      const image = imageFromElement(element, sourceUrl, paragraphs.length);
      if (image) media.push({ ...image, afterParagraph: paragraphs.length - 1 });
      continue;
    }
    if (element.querySelector(READABLE_BLOCK_SELECTOR)) continue;
    const text = normalizeBlockText(element.textContent);
    if (text) paragraphs.push(text);
  }
  return { paragraphs, media };
}

function imageFromElement(element: Element, baseUrl: string, paragraphPosition: number): Extract<ImportedArticleMedia, { type: 'image' }> | null {
  const images = element.tagName.toLowerCase() === 'img'
    ? [element]
    : Array.from(element.querySelectorAll('img'));
  for (const image of images) {
    if (image.getAttribute('aria-label') === 'image unavailable') continue;
    const srcSet = image.getAttribute('srcset') ?? image.getAttribute('srcSet');
    const bestSource = srcSet?.split(',').map((part) => part.trim().split(/\s+/u)[0]).filter(Boolean).at(-1);
    const url = mediaUrl(bestSource ?? image.getAttribute('data-src') ?? image.getAttribute('src'), baseUrl);
    if (!url || /(?:grey-placeholder|placeholder\.png)(?:\?|$)/iu.test(url)) continue;
    const figure = element.tagName.toLowerCase() === 'figure' ? element : element.closest('figure');
    const caption = shortText(figure?.querySelector('figcaption')?.textContent, 500);
    const figureTexts = figure ? Array.from(figure.querySelectorAll(READABLE_BLOCK_SELECTOR))
      .filter((block) => !block.querySelector(READABLE_BLOCK_SELECTOR))
      .map((block) => normalizeBlockText(block.textContent)).filter(Boolean) : [];
    const captionParagraphPositions = figureTexts.length <= 3 &&
      figureTexts.every((text) => text.length <= 500)
      ? figureTexts.map((_, index) => paragraphPosition + index)
      : [];
    const credit = figureTexts.find((text) => text !== caption) ?? null;
    return {
      type: 'image', afterParagraph: -1, url,
      caption,
      alt: shortText(image.getAttribute('alt') ?? image.getAttribute('aria-label'), 300),
      credit: shortText(credit, 100), captionParagraphPositions,
      width: positiveDimension(image.getAttribute('width')),
      height: positiveDimension(image.getAttribute('height')),
    };
  }
  return null;
}

function videoFromElement(
  element: Element,
  sourceUrl: string,
  defaultPoster: string | null,
): Extract<ImportedArticleMedia, { type: 'video' }> | null {
  const player = element.tagName.toLowerCase() === 'video' ? element : element.querySelector('video');
  const iframe = element.tagName.toLowerCase() === 'iframe' ? element : element.querySelector('iframe[src]');
  const directUrl = mediaUrl(player?.getAttribute('src') ?? player?.querySelector('source[src]')?.getAttribute('src'), sourceUrl);
  const url = directUrl ?? mediaUrl(iframe?.getAttribute('src'), sourceUrl) ?? mediaUrl(sourceUrl, sourceUrl);
  if (!url) return null;
  const posterUrl = mediaUrl(player?.getAttribute('poster'), sourceUrl) ??
    mediaUrl(element.querySelector('img')?.getAttribute('src'), sourceUrl) ?? defaultPoster;
  const figure = element.closest('figure') ?? element.querySelector('figure');
  return {
    type: 'video', afterParagraph: -1, url, posterUrl,
    caption: shortText(figure?.querySelector('figcaption')?.textContent ?? element.getAttribute('aria-label'), 500),
    direct: directUrl !== null,
  };
}

function findNextReadableParagraph(element: Element, paragraphs: readonly string[]): number | null {
  const root = element.closest('article') ?? element.closest('main');
  if (!root) return null;
  const ordered = Array.from(root.querySelectorAll('p,video,iframe,[data-component*="video"]'));
  const position = ordered.indexOf(element);
  for (const candidate of ordered.slice(position + 1)) {
    if (candidate.tagName.toLowerCase() !== 'p') continue;
    const index = paragraphs.indexOf(normalizeBlockText(candidate.textContent));
    if (index >= 0) return index;
  }
  return null;
}

function readVideoThumbnail(document: Document, baseUrl: string): string | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent) as Record<string, unknown>;
      if (data['@type'] !== 'VideoObject') continue;
      const raw = typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : null;
      if (raw) return mediaUrl(raw.replace('$recipe', '1024x576'), baseUrl);
    } catch { /* Invalid third-party metadata is ignored. */ }
  }
  return mediaUrl(document.querySelector('meta[property="og:image"]')?.getAttribute('content'), baseUrl);
}

function mediaUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    url.hash = '';
    const value = url.toString();
    return ImportedMediaUrlSchema.safeParse(value).success ? value : null;
  } catch { return null; }
}

function positiveDimension(raw: string | null): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function shortText(raw: string | null | undefined, limit: number): string | null {
  const text = normalizeBlockText(raw ?? '');
  return text ? Array.from(text).slice(0, limit).join('') : null;
}

function normalizeBlockText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
