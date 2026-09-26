import { buildEditorialReadingBlocks } from './editorialTypography';
import type { EditorialBodyBlock } from './catalog';

const image: EditorialBodyBlock = { type: 'image', image: 1, width: 608, height: 571 };

it('区分图片旁的正文、章节标题和明确署名，并保留原文及朗读段落索引', () => {
  const bodyBlocks: EditorialBodyBlock[] = [
    image,
    { type: 'text', text: 'Finance does not offer many sure bets.' },
    { type: 'text', text: 'The cost of borrowing' },
    image,
    { type: 'text', text: 'Photograph: Rachel Jessen' },
    { type: 'text', text: 'Fortunately, governments need not refinance everything all at once.' },
  ];
  const blocks = buildEditorialReadingBlocks({ paragraphs: [], bodyBlocks });
  expect(blocks.filter((block) => block.type === 'text')).toEqual([
    { ...bodyBlocks[1], role: 'body', paragraphIndex: 0 },
    { ...bodyBlocks[2], role: 'heading', paragraphIndex: 1 },
    { ...bodyBlocks[4], role: 'caption', paragraphIndex: 2 },
    { ...bodyBlocks[5], role: 'body', paragraphIndex: 3 },
  ]);
  expect(blocks[0]).toBe(image);
  expect(blocks[3]).toBe(image);
});

it('支持图片前的来源和图片后的带署名说明，不将远离图片的文字误作图注', () => {
  const blocks = buildEditorialReadingBlocks({ paragraphs: [], bodyBlocks: [
    { type: 'text', text: 'Source: FactSet' },
    image,
    { type: 'text', text: 'Parker, 75 days old, and ready to fledge (Credit: The Macaw Society)' },
    { type: 'text', text: 'Source: FactSet provided the data.' },
  ] });
  expect(blocks.map((block) => block.type === 'text' ? block.role : block.type))
    .toEqual(['caption', 'image', 'caption', 'body']);
});

it('优先使用已声明的章节标题，不猜测其他短段落', () => {
  const blocks = buildEditorialReadingBlocks({
    paragraphs: ['Q&A', 'Some other short text', 'It is also hard to pull off.'],
    sectionHeadings: ['Q&A'],
  });
  expect(blocks.map((block) => block.type === 'text' && block.role))
    .toEqual(['heading', 'body', 'body']);
});

it('历史正文只推断独立短标题，保留普通短句、单词及分隔符', () => {
  const blocks = buildEditorialReadingBlocks({ paragraphs: [
    'How wild foster parents help', 'It is also hard to pull off.', 'O.K.', '•', 'Yes',
  ] });
  expect(blocks.map((block) => block.type === 'text' && block.role))
    .toEqual(['heading', 'body', 'body', 'body', 'body']);
});
