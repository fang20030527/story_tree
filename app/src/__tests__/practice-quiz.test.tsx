import { render } from '@testing-library/react-native';
import type { PracticeDto } from '@context-reader/contracts';

import { getPractice } from '@/api/practices';
import PracticeQuizScreen from '@/app/practice/[id]/quiz';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({
    id: '11111111-1111-4111-8111-111111111111',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: jest.requireActual('@/constants/theme').themes.light,
  }),
}));
jest.mock('@/api/practices', () => ({
  getPractice: jest.fn(),
  submitAnswer: jest.fn(),
}));
jest.mock('@/api/installation', () => ({
  createIdempotencyKey: jest.fn().mockResolvedValue('answer-key-123'),
}));

const practice: PracticeDto = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'ready',
  modelName: 'test-model',
  remainingFreePractices: 2,
  failure: null,
  article: {
    title: 'How systems recover',
    wordCount: 6,
    paragraphs: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        position: 0,
        segments: [
          { text: 'A ', targetId: null },
          {
            text: 'resilient',
            targetId: '33333333-3333-4333-8333-333333333333',
          },
          { text: ' system adapts quickly.', targetId: null },
        ],
      },
    ],
  },
  questions: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      targetId: '33333333-3333-4333-8333-333333333333',
      term: 'resilient',
      prompt: '在本文语境中是什么意思？',
      options: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          label: '有韧性的',
        },
        {
          id: '66666666-6666-4666-8666-666666666666',
          label: '含糊的',
        },
        {
          id: '77777777-7777-4777-8777-777777777777',
          label: '一丝不苟的',
        },
        {
          id: '88888888-8888-4888-8888-888888888888',
          label: '短暂的',
        },
      ],
      submittedAnswer: null,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPractice).mockResolvedValue(practice);
});

it('places the source above the question in independently scrollable panes', async () => {
  const view = await render(<PracticeQuizScreen />);

  const sourcePane = await view.findByTestId('quiz-reference-scroll');
  const questionPane = view.getByTestId('quiz-question-scroll');
  expect(sourcePane).toBeTruthy();
  expect(questionPane).toBeTruthy();
  expect(view.getByTestId('quiz-reference-pane')).toHaveStyle({ flex: 1 });
  expect(view.getByTestId('quiz-question-pane')).toHaveStyle({ flex: 1 });
  expect(view.getByText('How systems recover')).toBeTruthy();
  expect(view.getByText('在本文语境中是什么意思？')).toBeTruthy();
});
