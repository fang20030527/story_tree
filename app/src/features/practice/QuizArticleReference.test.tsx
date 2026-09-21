import { render } from '@testing-library/react-native';
import type { ArticleParagraph } from '@context-reader/contracts';

import { themes } from '@/constants/theme';

import { QuizArticleReference } from './QuizArticleReference';

jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: jest.requireActual('@/constants/theme').themes.light,
  }),
}));

const paragraphs: ArticleParagraph[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    position: 0,
    segments: [
      { text: 'A ', targetId: null },
      {
        text: 'resilient',
        targetId: '22222222-2222-4222-8222-222222222222',
      },
      { text: ' system adapts.', targetId: null },
    ],
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    position: 1,
    segments: [
      { text: 'A ', targetId: null },
      {
        text: 'durable',
        targetId: '44444444-4444-4444-8444-444444444444',
      },
      { text: ' tool lasts.', targetId: null },
    ],
  },
];

it('renders the complete source and identifies the current question context', async () => {
  const view = await render(
    <QuizArticleReference
      activeTargetId="22222222-2222-4222-8222-222222222222"
      paragraphs={paragraphs}
      title="How systems recover"
    />,
  );

  expect(view.getByText('原文')).toBeTruthy();
  expect(view.getByText('How systems recover')).toBeTruthy();
  expect(view.getByText('第 1 段')).toBeTruthy();
  expect(view.getByText('durable')).toBeTruthy();
  expect(
    view.getByLabelText('当前题目原文词汇：resilient'),
  ).toHaveStyle({
    backgroundColor: themes.light.accentSoft,
    color: themes.light.accent,
  });
  expect(view.queryByLabelText('当前题目原文词汇：durable')).toBeNull();
});
