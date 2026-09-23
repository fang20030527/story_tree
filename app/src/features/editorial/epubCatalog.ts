import type { EditorialArticle, EditorialBodyBlock } from './catalog';
import { getApiBaseUrl } from '@/api/client';
import { epubMetadata, issueLoaders } from './epub/loaders';

const audioUrls = require('./epub/audio.json') as Record<string, string>;
const localizedMetadata = require('./epub/metadata-zh.json') as Record<string, {
  titleEn: string;
  titleZh: string;
  category: string;
  level: string;
}>;

function displayTitle(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/gi, '&');
}

export function getEpubImageUrl(id: string): string {
  try {
    return `${getApiBaseUrl()}/v1/editorial/images/${id}.webp`;
  } catch {
    // 未配置服务地址时仍能阅读本地正文；插图由图片组件显示占位。
    return '';
  }
}

export type RawEpubBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; asset: string; width: number; height: number };

export interface EpubMetadata {
  id: string;
  titleEn: string;
  summary: string;
  source: string;
  sourceUrl: string;
  category: string;
  wordCount: number;
  minutes: number;
  image: string;
  issueDate: string;
  issueKey: string;
  order: number;
}

// 索引只含概述；首次打开正文时才读取该期 JSON 和原刊插图。
export const epubArticles: readonly EditorialArticle[] = epubMetadata.map((entry) => {
  const candidate = localizedMetadata[entry.id];
  const localized = candidate?.titleEn === entry.titleEn ? candidate : undefined;
  let blocks: readonly EditorialBodyBlock[] | undefined;
  let paragraphs: readonly string[] | undefined;
  function readBody(): readonly EditorialBodyBlock[] {
    if (!blocks) {
      const raw = issueLoaders[entry.issueKey]?.()[entry.id];
      if (!raw) throw new Error(`外刊正文缺失：${entry.id}`);
      blocks = raw.map((block) => block.type === 'text' ? block : {
        type: 'image', image: getEpubImageUrl(block.asset), width: block.width, height: block.height,
      });
    }
    return blocks;
  }
  const article: EditorialArticle = {
    id: entry.id,
    titleZh: localized?.titleZh ?? entry.titleEn,
    titleEn: displayTitle(entry.titleEn),
    summaryZh: entry.summary,
    keyPointsZh: [localized?.category ?? entry.category, `${entry.source} · ${entry.issueDate} · 原文`],
    source: entry.source,
    category: localized?.category ?? entry.category,
    wordCount: entry.wordCount,
    minutes: entry.minutes,
    level: localized?.level ?? '难度待评估',
    get image() { return getEpubImageUrl(entry.image); },
    section: 'featured',
    issueDate: entry.issueDate,
    publishedAt: entry.issueDate,
    hasAudio: Boolean(audioUrls[entry.id]),
    get paragraphs() {
      paragraphs ??= readBody().flatMap((block) => block.type === 'text' ? [block.text] : []);
      return paragraphs;
    },
    get bodyBlocks() { return readBody(); },
  };
  // 避免对象展开被转成 Object.assign 后提前触发正文 getter。
  if (entry.sourceUrl) article.sourceUrl = entry.sourceUrl;
  if (audioUrls[entry.id]) article.audioUrl = audioUrls[entry.id];
  return article;
});
