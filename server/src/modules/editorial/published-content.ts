import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  PublishedEditorialArticleSchema,
  PublishedEditorialCatalogSchema,
  PublishedEditorialIdSchema,
  PublishedEditorialSummarySchema,
  type PublishedEditorialArticle,
  type PublishedEditorialCatalog,
} from '@context-reader/contracts';
import { z } from 'zod';

const MAX_ARTICLE_FILE_BYTES = 512 * 1_024;
const MAX_MEDIA_FILE_BYTES = 50 * 1_024 * 1_024;
const ASSET_PREFIX = '/v1/editorial/assets/';

export const PublishedEditorialAssetNameSchema = z.string()
  .min(6)
  .max(132)
  .regex(/^[a-z0-9][a-z0-9._-]{0,127}\.(?:webp|png|jpe?g|mp3)$/u);

const ArticleFileSchema = PublishedEditorialArticleSchema.omit({
  section: true,
  hasAudio: true,
  wordCount: true,
  minutes: true,
}).extend({
  status: z.enum(['draft', 'published']),
  wordCount: z.number().int().nonnegative().optional(),
  minutes: z.number().int().nonnegative().optional(),
}).strict();

type ArticleFile = z.infer<typeof ArticleFileSchema>;

function contentError(): Error {
  return new Error('外刊内容文件无效，请运行 editorial:validate 检查');
}

function referencedAssets(article: ArticleFile): string[] {
  const media = [
    article.image,
    article.audioUrl,
    ...(article.bodyBlocks?.flatMap((block) => block.type === 'image' ? [block.image] : []) ?? []),
    ...(article.figures?.map((figure) => figure.image) ?? []),
  ];
  return media.flatMap((value) => value?.startsWith(ASSET_PREFIX)
    ? [value.slice(ASSET_PREFIX.length)]
    : []);
}

function countWords(paragraphs: readonly string[]): number {
  return paragraphs.join(' ').match(/[A-Za-z]+(?:['’][A-Za-z]+)*/gu)?.length ?? 0;
}

function validateBody(article: ArticleFile): void {
  if (article.bodyBlocks) {
    const textBlocks = article.bodyBlocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text);
    if (textBlocks.length !== article.paragraphs.length
      || textBlocks.some((text, index) => text !== article.paragraphs[index])) {
      throw contentError();
    }
  }
  if (article.figures?.some((figure) => figure.afterParagraph >= article.paragraphs.length)) {
    throw contentError();
  }
  if (article.audioCues?.some((cue) => cue[0] >= article.paragraphs.length
    || cue[1] >= cue[2] || cue[3] >= cue[4])) {
    throw contentError();
  }
}

function toPublishedArticle(file: ArticleFile, section: 'today' | 'featured'): PublishedEditorialArticle {
  const article = ArticleFileSchema.omit({ status: true }).strip().parse(file);
  const words = file.wordCount ?? countWords(file.paragraphs);
  return PublishedEditorialArticleSchema.parse({
    ...article,
    section,
    wordCount: words,
    minutes: file.minutes ?? Math.max(1, Math.ceil(words / 160)),
    hasAudio: Boolean(file.audioUrl) || words > 0,
  });
}

function toSummary(article: PublishedEditorialArticle) {
  return PublishedEditorialSummarySchema.strip().parse(article);
}

export function createPublishedEditorialStore(contentDirectory: string) {
  let cached: Promise<{
    catalog: PublishedEditorialCatalog;
    articles: Map<string, PublishedEditorialArticle>;
    assets: Set<string>;
  }> | undefined;

  const load = async () => {
    const files = (await readdir(join(contentDirectory, 'articles')))
      .filter((name) => name.endsWith('.json')).sort();
    if (files.length > 5_000) throw contentError();
    const parsed: ArticleFile[] = [];
    const ids = new Set<string>();
    for (const name of files) {
      const id = name.slice(0, -'.json'.length);
      if (!PublishedEditorialIdSchema.safeParse(id).success || ids.has(id)) {
        throw contentError();
      }
      ids.add(id);
      const path = join(contentDirectory, 'articles', name);
      if ((await stat(path)).size > MAX_ARTICLE_FILE_BYTES) throw contentError();
      let value: unknown;
      try {
        value = JSON.parse(await readFile(path, 'utf8')) as unknown;
      } catch {
        throw contentError();
      }
      const result = ArticleFileSchema.safeParse(value);
      if (!result.success || result.data.id !== id) throw contentError();
      validateBody(result.data);
      parsed.push(result.data);
    }

    const published = parsed.filter((article) => article.status === 'published')
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)
        || right.id.localeCompare(left.id));
    const featuredArticleId = published[0]?.id;
    const assets = new Set<string>();
    for (const file of published) {
      for (const name of referencedAssets(file)) {
        if (!PublishedEditorialAssetNameSchema.safeParse(name).success) throw contentError();
        const info = await stat(join(contentDirectory, 'assets', name)).catch(() => null);
        if (!info?.isFile() || info.size > MAX_MEDIA_FILE_BYTES) throw contentError();
        assets.add(name);
      }
    }
    const articles = new Map<string, PublishedEditorialArticle>();
    const summaries = published.map((file, index) => {
      const article = toPublishedArticle(file, index === 0 ? 'today' : 'featured');
      articles.set(article.id, article);
      return toSummary(article);
    });
    return {
      catalog: PublishedEditorialCatalogSchema.parse({ articles: summaries, featuredArticleId }),
      articles,
      assets,
    };
  };

  const current = () => cached ??= load();
  return {
    list: async () => (await current()).catalog,
    get: async (id: string) => (await current()).articles.get(id),
    hasAsset: async (name: string) => (await current()).assets.has(name),
    validate: current,
  };
}
