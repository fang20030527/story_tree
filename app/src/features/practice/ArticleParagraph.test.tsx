import { act, fireEvent, render } from '@testing-library/react-native';

import { createIdempotencyKey } from '@/api/installation';
import { recordAssistance } from '@/api/practices';

import {
  ArticleParagraph,
  InteractiveArticleParagraph,
} from './ArticleParagraph';

jest.mock('@/api/installation', () => ({
  createIdempotencyKey: jest.fn(),
}));
jest.mock('@/api/practices', () => ({
  recordAssistance: jest.fn(),
}));

const mockedCreateIdempotencyKey = jest.mocked(createIdempotencyKey);
const mockedRecordAssistance = jest.mocked(recordAssistance);

describe('ArticleParagraph', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('styles only target segments and treats markup-like text literally', async () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    const onTargetPress = jest.fn();
    const view = await render(
      <ArticleParagraph
        onTargetPress={onTargetPress}
        segments={[
          { text: 'Read <strong>this</strong> ', targetId: null },
          { text: 'resilient', targetId },
          { text: ' example.', targetId: null },
        ]}
        targetColor="#f0b429"
      />,
    );

    expect(view.getByText('Read <strong>this</strong> ').props.style).toBeUndefined();
    expect(view.getByText('resilient')).toHaveStyle({
      color: '#f0b429',
      fontWeight: '600',
    });

    await fireEvent.press(view.getByText('resilient'));
    expect(onTargetPress).toHaveBeenCalledWith(targetId);
  });

  it('reveals a word hint only after assistance recording succeeds', async () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    const practiceId = '22222222-2222-4222-8222-222222222222';
    let resolveAssistance: ((value: {
      recorded: true;
      hintMeaningZh: string | null;
    }) => void) | undefined;
    mockedCreateIdempotencyKey.mockResolvedValue('hint_key_1234567890');
    mockedRecordAssistance.mockReturnValue(new Promise((resolve) => {
      resolveAssistance = resolve;
    }));

    const view = await render(
      <InteractiveArticleParagraph
        practiceId={practiceId}
        segments={[{ text: 'resilient', targetId }]}
        targetColor="#f0b429"
        targetTerms={{ [targetId]: 'resilient' }}
      />,
    );

    await fireEvent.press(view.getByText('resilient'));
    expect(mockedRecordAssistance).toHaveBeenCalledWith(
      practiceId,
      { kind: 'word_hint', targetId },
      'hint_key_1234567890',
    );
    expect(view.queryByText('有韧性的')).toBeNull();

    await act(async () => {
      resolveAssistance?.({ recorded: true, hintMeaningZh: '有韧性的' });
      await Promise.resolve();
    });
    expect(view.getByText('有韧性的')).toBeTruthy();
  });
});
