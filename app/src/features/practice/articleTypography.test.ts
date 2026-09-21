import { isArticleSectionHeading } from './articleTypography';

describe('导入文章章节标题识别', () => {
  it.each([
    'How wild foster parents help',
    'Why do scarlet macaws neglect their youngest chicks?',
    'The flaws in fostering',
  ])('识别独立短标题：%s', (text) => {
    expect(isArticleSectionHeading(text)).toBe(true);
  });

  it.each([
    'It is also hard to pull off.',
    'He asked, “Why?”',
    'First line\nSecond line',
    'The parents are forced to choose, she says. If they stretch too much to feed them all, there is a risk none will make it.',
    '',
  ])('保留正文样式：%s', (text) => {
    expect(isArticleSectionHeading(text)).toBe(false);
  });
});
