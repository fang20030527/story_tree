import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { AppError } from '../../../core/errors';
import type { ExtractedArticle } from './types';

export function extractReadableHtml(
  html: string,
  sourceUrl: string,
): ExtractedArticle {
  const { document } = parseHTML(html);
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
  const text = parsed?.textContent?.trim() ?? '';
  if (!text) {
    throw new AppError(
      'IMPORT_PARSE_FAILED',
      '未能从网页中提取正文，请粘贴正文',
      422,
    );
  }
  return { title: parsed?.title?.trim() || null, text };
}
