import { isArticleSectionHeading } from '@/features/practice/articleTypography';
import type { EditorialArticle, EditorialBodyBlock } from './catalog';

export type EditorialTextRole = 'body' | 'heading' | 'caption';
export type EditorialReadingBlock =
  | Extract<EditorialBodyBlock, { type: 'image' }>
  | { type: 'text'; text: string; paragraphIndex: number; role: EditorialTextRole };

// 历史 EPUB 未保留图注标签，仅在图片相邻处识别明确的来源或摄影署名。
const captionCredit = /^(?:(?:image|photo(?:graph)?|illustration|chart|picture|caption|credit|source)s?(?:\s+credits?)?\s*[:：]|(?:photo(?:graph)?|illustration|image)\s+by\b)|\((?:credit|source)\s*[:：]/iu;

export function buildEditorialReadingBlocks(
  article: Pick<EditorialArticle, 'bodyBlocks' | 'paragraphs' | 'sectionHeadings'>,
): EditorialReadingBlock[] {
  const blocks = article.bodyBlocks ?? article.paragraphs.map((text) => ({ type: 'text' as const, text }));
  let paragraphIndex = 0;
  return blocks.map((block, index) => {
    if (block.type === 'image') return block;
    const text = block.text.trim();
    const besideImage = blocks[index - 1]?.type === 'image' || blocks[index + 1]?.type === 'image';
    let role: EditorialTextRole = 'body';
    if (article.sectionHeadings?.includes(block.text)) {
      role = 'heading';
    } else if (besideImage && text.length <= 500 && captionCredit.test(text)) {
      role = 'caption';
    } else if (!article.sectionHeadings && text.split(/\s+/u).length >= 2 && isArticleSectionHeading(text)) {
      role = 'heading';
    }
    // 图注仍占用原段落索引，保证朗读定位、翻译缓存和生词上下文不变。
    return { ...block, paragraphIndex: paragraphIndex++, role };
  });
}
