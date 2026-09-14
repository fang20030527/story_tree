import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { createIdempotencyKey } from '@/api/installation';
import { recordAssistance } from '@/api/practices';

import {
  ArticleParagraph,
  InteractiveArticleParagraph,
  InteractiveWordParagraph,
  tokenizeArticleText,
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

  it('keeps article text intact while exposing tapped words and saving a card', async () => {
    const lookupWord = jest.fn().mockResolvedValue('有韧性的');
    const addToVocabulary = jest.fn().mockResolvedValue(undefined);
    mockedCreateIdempotencyKey.mockResolvedValue('word-card-key-1234');
    const view = await render(
      <InteractiveWordParagraph
        lookupWord={lookupWord}
        onAddToVocabulary={addToVocabulary}
        targetColor="#f0b429"
        text="A resilient reader updates context."
      />,
    );

    expect(tokenizeArticleText('A resilient reader updates context.')
      .map((token) => token.text)
      .join('')).toBe('A resilient reader updates context.');
    expect(tokenizeArticleText('A long-term plan.')
      .filter((token) => token.isWord)
      .map((token) => token.text)).toEqual(['A', 'long-term', 'plan']);
    await fireEvent.press(view.getByText('resilient'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(lookupWord).toHaveBeenCalledWith(
      'resilient',
      'A resilient reader updates context.',
    );
    expect(view.getByText('有韧性的')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('加入生词本'));
    await waitFor(() => expect(addToVocabulary).toHaveBeenCalledWith(
      {
        term: 'resilient',
        meaningZh: '有韧性的',
        sourceSentence: 'A resilient reader updates context.',
      },
      'word-card-key-1234',
    ));
    expect(view.getByText('已加入生词本')).toBeTruthy();
  });

  it('shows the API part of speech and keeps unsaved words black', async () => {
    const lookupWord = jest.fn().mockResolvedValue({
      partOfSpeech: '动词',
      meaningZh: '困住；使受困',
    });
    const view = await render(
      <InteractiveWordParagraph
        lookupWord={lookupWord}
        onAddToVocabulary={jest.fn().mockResolvedValue(undefined)}
        targetColor="#f0b429"
        text="People were trapped near the frontline."
        textColor="#ffffff"
      />,
    );

    await fireEvent.press(view.getByText('trapped'));
    await waitFor(() => {
      expect(view.getByText('动词')).toBeTruthy();
      expect(view.getByText('困住；使受困')).toBeTruthy();
    });
    expect(view.getAllByText('trapped')[0]).toHaveStyle({ color: '#000000' });
  });

  it('highlights a word with a yellow background after the vocabulary save succeeds', async () => {
    const addToVocabulary = jest.fn().mockResolvedValue(undefined);
    const lookupWord = jest.fn().mockResolvedValue({
      partOfSpeech: '动词',
      meaningZh: '困住；使受困',
    });
    mockedCreateIdempotencyKey.mockResolvedValue('word-card-key-5678');
    const view = await render(
      <InteractiveWordParagraph
        lookupWord={lookupWord}
        onAddToVocabulary={addToVocabulary}
        targetColor="#f0b429"
        text="People were trapped near the frontline."
      />,
    );

    await fireEvent.press(view.getByText('trapped'));
    await waitFor(() => expect(view.getByText('动词')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('加入生词本'));
    await waitFor(() => expect(view.getByText('已加入生词本')).toBeTruthy());
    expect(view.getAllByText('trapped')[0]).toHaveStyle({
      color: '#000000',
      backgroundColor: '#f3bb31',
    });
  });

});
