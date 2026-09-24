import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { PracticeDto } from '@context-reader/contracts';

import { getPractice, submitAnswer } from '@/api/practices';
import PracticeQuizScreen from '@/app/practice/[id]/quiz';

jest.mock('@/features/study/useStudyTimer', () => ({ useStudyTimer: jest.fn() }));
jest.mock('@/features/practice/usePracticeExitGuard', () => ({ usePracticeExitGuard: () => jest.requireActual('react').useCallback((action: () => void) => action(), []) }));
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

it('hides the source and target heading for English contextual self-tests', async () => {
  const next = JSON.parse(JSON.stringify(practice)) as typeof practice;
  next.questions[0]!.prompt = 'Despite setbacks, the team remained ____.';
  next.questions[0]!.options.forEach((option, index) => {
    option.label = ['resilient', 'fragile', 'temporary', 'ambiguous'][index]!;
  });
  jest.mocked(getPractice).mockResolvedValue(next);
  const view = await render(<PracticeQuizScreen />);
  expect(await view.findByText('Vocabulary self-test')).toBeTruthy();
  expect(view.queryByTestId('quiz-reference-pane')).toBeNull();
  expect(view.getAllByText('resilient')).toHaveLength(1);
  expect(view.getByLabelText('Check answer')).toBeTruthy();
});

function completedPractice(): PracticeDto {
  const next = JSON.parse(JSON.stringify(practice)) as PracticeDto;
  next.status = 'completed';
  const question = next.questions[0]!;
  question.submittedAnswer = {
    answerKind: 'option', selectedOptionId: question.options[1]!.id,
    isCorrect: false, wasAssisted: true, correctOptionId: question.options[0]!.id,
    meaningEn: 'able to recover', explanationZh: '表示从困难中恢复的能力', optionExplanations: {},
  };
  next.questions.push({ ...question, id: '99999999-9999-4999-8999-999999999999', prompt: '第二题' });
  return next;
}

it('opens completed questions with original feedback and supports navigation in both directions', async () => {
  jest.mocked(getPractice).mockResolvedValue(completedPractice());
  const view = await render(<PracticeQuizScreen />);
  expect(await view.findByText('回看题目 · 首次作答与解析')).toBeTruthy();
  expect(view.getByText('表示从困难中恢复的能力')).toBeTruthy();
  expect(view.queryByText('暂时无法加载题目')).toBeNull();
  expect(router.replace).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('下一题'));
  expect(view.getByText('第二题')).toBeTruthy();
  await fireEvent.press(view.getByText('上一题'));
  expect(view.getByText('在本文语境中是什么意思？')).toBeTruthy();
  expect(submitAnswer).not.toHaveBeenCalled();
});

it('retries all questions, scores new answers locally and preserves the original results', async () => {
  const original = completedPractice();
  jest.mocked(getPractice).mockResolvedValue(original);
  const view = await render(<PracticeQuizScreen />);
  await fireEvent.press(await view.findByText('再练一次'));
  expect(view.queryByText('表示从困难中恢复的能力')).toBeNull();
  await fireEvent.press(view.getByText('有韧性的'));
  await fireEvent.press(view.getByLabelText('提交答案'));
  expect(await view.findByText('回答正确')).toBeTruthy();
  await fireEvent.press(view.getByText('下一题'));
  await fireEvent.press(view.getByText('我不知道'));
  await fireEvent.press(await view.findByText('完成本轮'));
  expect(view.getByText('本轮完成，答对 1/2 题')).toBeTruthy();
  expect(view.getByText('正确义项已标出')).toBeTruthy();
  expect(original.questions[0]!.submittedAnswer?.isCorrect).toBe(false);
  expect(submitAnswer).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('再练一次'));
  expect(view.queryByText('本轮完成，答对 1/2 题')).toBeNull();
  expect(view.getByLabelText('提交答案')).toBeTruthy();
});

it('still submits first attempts to the server and navigates to results after completion', async () => {
  const completed = completedPractice();
  completed.questions = completed.questions.slice(0, 1);
  jest.mocked(getPractice).mockResolvedValueOnce(practice).mockResolvedValue(completed);
  jest.mocked(submitAnswer).mockResolvedValue(completed.questions[0]!.submittedAnswer!);
  const view = await render(<PracticeQuizScreen />);
  await fireEvent.press(await view.findByText('含糊的'));
  await fireEvent.press(view.getByLabelText('提交答案'));
  await fireEvent.press(await view.findByText('继续'));
  expect(submitAnswer).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/practice/[id]/result', params: { id: practice.id } }));
});

it('can retry a failed load and then review a completed practice', async () => {
  jest.mocked(getPractice).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(completedPractice());
  const view = await render(<PracticeQuizScreen />);
  await fireEvent.press(await view.findByText('重试'));
  expect(await view.findByText('回看题目 · 首次作答与解析')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
});
