import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { AppError } from '../../../core/errors';
import type { ExtractedArticle } from './types';

const READABLE_BLOCK_SELECTOR = [
  'article',
  'section',
  'div',
  'p',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'li',
  'figcaption',
].join(',');

export function extractReadableHtml(
  html: string,
  sourceUrl: string,
): ExtractedArticle {
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
  for (const element of document.querySelectorAll(
    'script,style,noscript,template,iframe,object,embed',
  )) {
    element.remove();
  }
  const base = document.createElement('base');
  base.setAttribute('href', sourceUrl);
  document.head.prepend(base);
  const readableDocument = document.cloneNode(true) as unknown as
    ConstructorParameters<typeof Readability>[0];
  const parsed = new Readability(readableDocument, {
    charThreshold: 20,
    maxElemsToParse: 50_000,
    disableJSONLD: false,
  }).parse();
  const text = parsed
    ? extractReadableText(parsed.content, parsed.textContent)
    : '';
  if (!text) {
    throw new AppError(
      'IMPORT_PARSE_FAILED',
      '未能从网页中提取正文，请粘贴正文',
      422,
    );
  }
  return { title: parsed?.title?.trim() || null, text };
}

function extractReadableText(
  content: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const { document } = parseHTML(content ?? '');
  const blocks = Array.from(
    document.querySelectorAll(READABLE_BLOCK_SELECTOR),
  )
    .filter((element) => !element.querySelector(READABLE_BLOCK_SELECTOR))
    .map((element) => normalizeBlockText(element.textContent))
    .filter(Boolean);

  return blocks.length > 0
    ? blocks.join('\n\n')
    : normalizeBlockText(fallback ?? '');
}

function normalizeBlockText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
