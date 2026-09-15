import { fireEvent, render } from '@testing-library/react-native';
import type { AnswerResult, PublicQuestion } from '@context-reader/contracts';

import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';

import { QuizQuestion } from './QuizQuestion';

jest.mock('@/api/installation', () => ({
  createIdempotencyKey: jest.fn(),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: jest.requireActual('@/constants/theme').themes.light,
  }),
}));

const mockedCreateIdempotencyKey = jest.mocked(createIdempotencyKey);
const optionIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
] as const;

function question(submittedAnswer: AnswerResult | null = null): PublicQuestion {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    targetId: '66666666-6666-4666-8666-666666666666',
    term: 'resilient',
    prompt: '在本文语境中是什么意思？',
    options: optionIds.map((id, index) => ({
      id,
      label: ['有韧性的', '含糊的', '一丝不苟的', '短暂的'][index] as string,
    })),
    submittedAnswer,
  };
}

function feedback(answerKind: 'option' | 'dont_know'): AnswerResult {
  const shared = {
    isCorrect: answerKind === 'option',
    wasAssisted: false,
    correctOptionId: optionIds[0],
    meaningEn: 'able to recover quickly',
    explanationZh: '文章描述了从困难中恢复的能力。',
    optionExplanations: Object.fromEntries(optionIds.map((id, index) => [
      id,
      `选项 ${index + 1} 的解释`,
    ])),
  };
  return answerKind === 'option'
    ? {
        answerKind: 'option',
        selectedOptionId: optionIds[0],
        ...shared,
        isCorrect: true,
      }
    : {
        answerKind: 'dont_know',
        selectedOptionId: null,
        ...shared,
        isCorrect: false,
      };
}

describe('QuizQuestion', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedCreateIdempotencyKey.mockResolvedValue('answer_key_123456789');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps feedback hidden and submit disabled until an option is selected', async () => {
    const view = await render(
      <QuizQuestion
        onContinue={jest.fn()}
        onSubmit={jest.fn()}
        question={question()}
      />,
    );

    expect(view.queryByText('文章描述了从困难中恢复的能力。')).toBeNull();
    expect(view.getByLabelText('提交答案')).toBeDisabled();

    await fireEvent.press(view.getByText('有韧性的'));
    expect(view.getByLabelText('提交答案')).toBeEnabled();
  });

  it('submits dont-know once with the retained key and locks feedback', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const onSubmit = jest.fn().mockResolvedValue(feedback('dont_know'));
    const view = await render(
      <QuizQuestion
        onContinue={jest.fn()}
        onSubmit={onSubmit}
        question={question()}
      />,
    );

    now = 1_350;
    await fireEvent.press(view.getByText('我不知道'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      { answerKind: 'dont_know' },
      350,
      'answer_key_123456789',
    );
    expect(view.getByText('文章描述了从困难中恢复的能力。')).toBeTruthy();
    for (const option of view.getAllByRole('radio')) {
      expect(option).toBeDisabled();
    }
  });

  it('keeps the same answer key when an option submission is retried', async () => {
    const onSubmit = jest.fn()
      .mockRejectedValueOnce(
        new ApiError('NETWORK_ERROR', '网络连接失败', true),
      )
      .mockResolvedValueOnce(feedback('option'));
    const view = await render(
      <QuizQuestion
        onContinue={jest.fn()}
        onSubmit={onSubmit}
        question={question()}
      />,
    );

    await fireEvent.press(view.getByText('有韧性的'));
    await fireEvent.press(view.getByLabelText('提交答案'));
    expect(view.getByText('网络连接失败')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('提交答案'));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls.map((call) => call[2])).toEqual([
      'answer_key_123456789',
      'answer_key_123456789',
    ]);
    expect(mockedCreateIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(view.getByText('回答正确')).toBeTruthy();
  });

  it('renders an immutable submitted answer without submitting again', async () => {
    const onSubmit = jest.fn();
    const onContinue = jest.fn();
    const view = await render(
      <QuizQuestion
        onContinue={onContinue}
        onSubmit={onSubmit}
        question={question(feedback('option'))}
      />,
    );

    expect(view.getByText('回答正确')).toBeTruthy();
    for (const option of view.getAllByRole('radio')) {
      expect(option).toBeDisabled();
    }
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText('继续'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

 it('keeps the target out of the heading and shows English feedback only after a cloze answer', async () => {
  const cloze = { ...question(), prompt: 'Despite setbacks, the team remained ____.',
    options: optionIds.map((id, index) => ({ id, label: ['resilient', 'fragile', 'temporary', 'ambiguous'][index]! })) };
  const answer = { ...feedback('option'), explanationZh: 'Recovering after setbacks shows resilience.',
    optionExplanations: { [optionIds[0]]: 'Fits the ability to recover.' } };
  const onSubmit = jest.fn().mockResolvedValue(answer);
  const view = await render(<QuizQuestion question={cloze} onSubmit={onSubmit} onContinue={jest.fn()} />);
  expect(view.getAllByText('resilient')).toHaveLength(1);
  expect(view.queryByText(answer.explanationZh)).toBeNull();
  expect(view.getByLabelText('Check answer')).toBeDisabled();
  await fireEvent.press(view.getByText('resilient'));
  await fireEvent.press(view.getByLabelText('Check answer'));
  expect(view.getByText('Correct!')).toBeTruthy();
  expect(view.getByText(answer.explanationZh)).toBeTruthy();
 });
