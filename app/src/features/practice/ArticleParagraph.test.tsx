import { ReadingOverlayProvider, useReadingOverlay } from './ReadingOverlay';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { TextLayoutLine } from 'react-native';
import { ScrollView } from 'react-native';
import type { ReactNode } from 'react';

import { requestSentenceTranslation } from '@/api/sentences';

import { createIdempotencyKey } from '@/api/installation';
import { recordAssistance, requestWordTranslation } from '@/api/practices';

import {
  ArticleParagraph,
  InteractiveArticleParagraph,
  InteractiveWordParagraph,
  tokenizeArticleText,
  contextForWord,
  sentenceAtOffset,
  sentenceEndLine,
} from './ArticleParagraph';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-speech', () => ({
  speak: jest.fn(), stop: jest.fn().mockResolvedValue(undefined),
  getAvailableVoicesAsync: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/api/sentences', () => ({ requestSentenceTranslation: jest.fn() }));

jest.mock('@/api/installation', () => ({
  createIdempotencyKey: jest.fn(),
}));
jest.mock('@/api/practices', () => ({
  recordAssistance: jest.fn(),
  requestWordTranslation: jest.fn(),
}));

const mockedCreateIdempotencyKey = jest.mocked(createIdempotencyKey);
const mockedRecordAssistance = jest.mocked(recordAssistance);

describe('ArticleParagraph', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(requestWordTranslation).mockResolvedValue({
      term: 'resilient', partOfSpeech: 'adj.', meaningZh: '有韧性的',
      phoneticUk: '/rɪˈzɪliənt/', phoneticUs: '/rɪˈzɪliənt/',
    });
  });

  it('keeps target segments unmarked and treats markup-like text literally', async () => {
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
    expect(view.getByText('resilient').props.style).toBeUndefined();

    await fireEvent.press(view.getByText('resilient'));
    expect(onTargetPress).toHaveBeenCalledWith(targetId);
  });

  it('reveals a word hint only after assistance recording succeeds', async () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    const practiceId = '22222222-2222-4222-8222-222222222222';
    let resolveAssistance: ((value: {
      recorded: true;
      hintMeaningZh: string | null;
      sourceSentence?: string | null;
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
      resolveAssistance?.({ recorded: true, hintMeaningZh: '有韧性的', sourceSentence: 'The original reader was resilient.' });
      await Promise.resolve();
    });
    expect(view.getByText('有韧性的')).toBeTruthy();
    expect(view.getByText('The original reader was resilient.')).toBeTruthy();
    await waitFor(() => expect(view.getAllByText('/rɪˈzɪliənt/')).toHaveLength(2));
    expect(view.getByText('adj.')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('关闭词义提示'));
    await fireEvent.press(view.getByText('resilient'));
    expect(view.getByText('The original reader was resilient.')).toBeTruthy();
    expect(mockedRecordAssistance).toHaveBeenCalledTimes(1);
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
      expect(view.getByText('v.')).toBeTruthy();
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
    await waitFor(() => expect(view.getByText('v.')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('加入生词本'));
    await waitFor(() => expect(view.getByText('已加入生词本')).toBeTruthy());
    expect(view.getAllByText('trapped')[0]).toHaveStyle({
      color: '#000000',
      backgroundColor: '#f3bb31',
    });
  });

  it('saves the sentence at the tapped occurrence, even when a word repeats', async () => {
    const lookupWord = jest.fn().mockResolvedValue({ partOfSpeech: '名词', meaningZh: '河岸', phoneticUk: '/bæŋk/', phoneticUs: '/bæŋk/' });
    const save = jest.fn().mockResolvedValue(undefined);
    mockedCreateIdempotencyKey.mockResolvedValue('repeated-word-key-01');
    const view = await render(<InteractiveWordParagraph
      text="The bank lends money. We sit by the bank. Birds sing."
      targetColor="#f0b429" lookupWord={lookupWord} onAddToVocabulary={save}
    />);
    await fireEvent.press(view.getAllByText('bank')[1]);
    await waitFor(() => expect(view.getByText('河岸')).toBeTruthy());
    expect(lookupWord).toHaveBeenCalledWith('bank', 'We sit by the bank.');
    expect(view.getAllByText('/bæŋk/')).toHaveLength(2);
    await fireEvent.press(view.getByLabelText('加入生词本'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ term: 'bank', meaningZh: '河岸', sourceSentence: 'We sit by the bank.' }, 'repeated-word-key-01'));
    expect(view.getByText('We sit by the bank.')).toBeTruthy();
  });

  it('displays the saved source alongside a new contextual meaning', async () => {
    const view = await render(<InteractiveWordParagraph
      text="A bank lends money." targetColor="#f0b429"
      lookupWord={jest.fn().mockResolvedValue({ partOfSpeech: 'n.', meaningZh: '银行', savedSourceSentence: 'We sit by the bank.' })}
    />);
    await fireEvent.press(view.getByText('bank'));
    await waitFor(() => expect(view.getByText('银行')).toBeTruthy());
    expect(view.getByText('We sit by the bank.')).toBeTruthy();
  });

  it('preserves the original sentence across previously cached occurrences', async () => {
    mockedCreateIdempotencyKey.mockResolvedValue('save-original-sentence');
    const lookupWord = jest.fn().mockResolvedValue({ partOfSpeech: 'n.', meaningZh: '银行' });
    const save = jest.fn().mockResolvedValue(undefined);
    const view = await render(<InteractiveWordParagraph
      text="A bank lends money. We sit by the bank." targetColor="#f0b429"
      lookupWord={lookupWord} onAddToVocabulary={save}
    />);
    await fireEvent.press(view.getAllByText('bank')[1]);
    await waitFor(() => expect(view.getByText('银行')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('关闭词义提示'));
    await fireEvent.press(view.getAllByText('bank')[0]);
    await waitFor(() => expect(view.getByText('银行')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('加入生词本'));
    await waitFor(() => expect(view.getByText('A bank lends money.')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('关闭词义提示'));
    await fireEvent.press(view.getAllByText('bank')[1]);
    expect(view.getByText('A bank lends money.')).toBeTruthy();
    expect(lookupWord).toHaveBeenCalledTimes(2);
  });

  it('refreshes an unsaved cached lookup after the word is saved elsewhere', async () => {
    const lookupWord = jest.fn()
      .mockResolvedValueOnce({ partOfSpeech: 'n.', meaningZh: '银行', savedSourceSentence: null })
      .mockResolvedValueOnce({ partOfSpeech: 'n.', meaningZh: '银行', savedSourceSentence: 'We sit by the bank.' });
    const view = await render(<InteractiveWordParagraph
      text="A bank lends money." targetColor="#f0b429" lookupWord={lookupWord}
    />);
    await fireEvent.press(view.getByText('bank'));
    await waitFor(() => expect(view.getByText('银行')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('关闭词义提示'));
    await view.rerender(<InteractiveWordParagraph
      text="A bank lends money." targetColor="#f0b429" lookupWord={lookupWord} addedWords={new Set(['bank'])}
    />);
    await fireEvent.press(view.getByText('bank'));
    await waitFor(() => expect(view.getByText('We sit by the bank.')).toBeTruthy());
    expect(lookupWord).toHaveBeenCalledTimes(2);
  });

  it('saves the full long sentence while bounding dictionary context', async () => {
    mockedCreateIdempotencyKey.mockResolvedValue('save-full-sentence');
    const sentence = `A resilient ${'community '.repeat(120)}recovered.`;
    const lookupWord = jest.fn().mockResolvedValue({ partOfSpeech: 'adj.', meaningZh: '有韧性的' });
    const save = jest.fn().mockResolvedValue(undefined);
    const view = await render(<InteractiveWordParagraph
      text={sentence} targetColor="#f0b429" lookupWord={lookupWord} onAddToVocabulary={save}
    />);
    await fireEvent.press(view.getByText('resilient'));
    await waitFor(() => expect(view.getByText('有韧性的')).toBeTruthy());
    expect(lookupWord.mock.calls[0][1].length).toBeLessThanOrEqual(1_000);
    await fireEvent.press(view.getByLabelText('加入生词本'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      term: 'resilient', meaningZh: '有韧性的', sourceSentence: sentence,
    }, 'save-full-sentence'));
    expect(view.getAllByText(sentence)).toHaveLength(2);
  });

  it('keeps saved AI context readable if the dictionary service fails', async () => {
    mockedCreateIdempotencyKey.mockResolvedValue('hint_key_1234567890');
    mockedRecordAssistance.mockResolvedValue({ recorded: true, hintMeaningZh: '有韧性的', sourceSentence: 'An earlier resilient community recovered.' });
    jest.mocked(requestWordTranslation).mockRejectedValue(new Error('offline'));
    const view = await render(<InteractiveArticleParagraph practiceId="p1" segments={[{ text: 'resilient', targetId: 't1' }]} targetTerms={{ t1: 'resilient' }} targetColor="#f0b429" />);
    await fireEvent.press(view.getByText('resilient'));
    await waitFor(() => expect(view.getByText('音标和词性加载失败 · 重试')).toBeTruthy());
    expect(view.getByText('An earlier resilient community recovered.')).toBeTruthy();
    expect(view.getByText('有韧性的')).toBeTruthy();
  });

  it('bounds a very long sentence while retaining the selected word', () => {
    const paragraph = `${'word '.repeat(210)}resilient ${'word '.repeat(210)}.`;
    const context = contextForWord(paragraph, 'resilient');
    expect(context.length).toBeLessThanOrEqual(1_000);
    expect(context).toContain('resilient');
    expect(contextForWord('Banking grows. A bank opens.', 'bank')).toBe('A bank opens.');
    expect(contextForWord('Dr. Smith saw a resilient reader. It was late.', 'resilient')).toBe('Dr. Smith saw a resilient reader.');
    expect(contextForWord('It cost 3.5 dollars. The resilient reader paid.', 'cost')).toBe('It cost 3.5 dollars.');
    expect(contextForWord('She said "hello." A resilient reader smiled.', 'resilient')).toBe('A resilient reader smiled.');
  });
});

function ScrollingReader({ children }: { children?: ReactNode }) {
  const overlay = useReadingOverlay();
  return <ScrollView testID="test-reader-scroll"
    onScrollBeginDrag={() => overlay?.select(null)}
    onScroll={(event) => overlay?.onScroll(event.nativeEvent.contentOffset.y)}>
    {children}
  </ScrollView>;
}

describe('sentence translation', () => {
  beforeEach(() => jest.mocked(requestSentenceTranslation).mockReset());

  it('anchors to the last line of the selected sentence, including repeated sentences', () => {
    const text = 'Birds fly high. Birds fly high. Fish swim.';
    const lines = ['Birds fly ', 'high. Birds ', 'fly high. ', 'Fish swim.'].map((line, index) => ({
      text: line, x: 0, y: index * 28, height: 28, width: 200,
      ascender: 18, descender: 4, capHeight: 16, xHeight: 12,
    } satisfies TextLayoutLine));
    expect(sentenceEndLine(text, 0, lines)).toBe(lines[1]);
    expect(sentenceEndLine(text, text.lastIndexOf('Birds'), lines)).toBe(lines[2]);
  });

  it('keeps translations during word lookup and replaces them only for another sentence or explicit close', async () => {
    jest.mocked(requestSentenceTranslation).mockResolvedValueOnce('鸟儿飞翔。').mockResolvedValueOnce('猫睡觉。');
    const view = await render(
      <ReadingOverlayProvider>
        <InteractiveWordParagraph text="Birds fly. Fish swim." targetColor="#123456" />
        <InteractiveWordParagraph text="Cats sleep." targetColor="#123456" lookupWord={async () => '猫'} />
      </ReadingOverlayProvider>,
    );
    await fireEvent(view.getByText('Birds'), 'longPress', { nativeEvent: { pageX: 140, pageY: 120 } });
    await waitFor(() => expect(view.getByText('鸟儿飞翔。')).toBeTruthy());
    expect(view.getByTestId('sentence-floating-bubble')).toHaveStyle({ position: 'absolute', top: 128 });
    await fireEvent.press(view.getByText('Cats'), { nativeEvent: { pageX: 140, pageY: 200 } });
    await waitFor(() => expect(view.getByText('猫')).toBeTruthy());
    expect(view.getByText('鸟儿飞翔。')).toBeTruthy();
    await fireEvent(view.getByText('sleep'), 'longPress', { nativeEvent: { pageX: 140, pageY: 200 } });
    await waitFor(() => expect(view.getByText('猫睡觉。')).toBeTruthy());
    expect(view.queryByText('鸟儿飞翔。')).toBeNull();
    expect(view.getAllByTestId('sentence-floating-bubble')).toHaveLength(1);
    await fireEvent.press(view.getByLabelText('关闭单句翻译'));
    expect(view.queryByTestId('sentence-floating-bubble')).toBeNull();
  });

  it('retains a pending translation through scrolling and paragraph recycling, and returns to its anchor', async () => {
    let resolveTranslation!: (value: string) => void;
    jest.mocked(requestSentenceTranslation).mockImplementation(() => new Promise((resolve) => { resolveTranslation = resolve; }));
    const reader = (showParagraph: boolean) => (
      <ReadingOverlayProvider>
        <ScrollingReader>
          {showParagraph ? <InteractiveWordParagraph text="Birds fly." targetColor="#123456" /> : null}
        </ScrollingReader>
      </ReadingOverlayProvider>
    );
    const view = await render(reader(true));
    await fireEvent(view.getByText('Birds'), 'longPress', { nativeEvent: { pageX: 140, pageY: 220 } });
    await fireEvent(view.getByTestId('test-reader-scroll'), 'scrollBeginDrag');
    await fireEvent.scroll(view.getByTestId('test-reader-scroll'), { nativeEvent: { contentOffset: { y: 40 } } });
    expect(view.getByTestId('sentence-floating-bubble')).toHaveStyle({ top: 188 });
    expect(view.getByLabelText('句子翻译中')).toBeTruthy();
    await fireEvent.scroll(view.getByTestId('test-reader-scroll'), { nativeEvent: { contentOffset: { y: 1000 } } });
    expect(view.getByTestId('sentence-floating-bubble')).toHaveStyle({ top: 12 });
    await view.rerender(reader(false));
    await act(async () => resolveTranslation('鸟儿飞翔。'));
    expect(view.getByText('鸟儿飞翔。')).toBeTruthy();
    await view.rerender(reader(true));
    await fireEvent.scroll(view.getByTestId('test-reader-scroll'), { nativeEvent: { contentOffset: { y: 0 } } });
    expect(view.getByTestId('sentence-floating-bubble')).toHaveStyle({ top: 228 });
    expect(requestSentenceTranslation).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('关闭单句翻译'));
    expect(view.queryByTestId('sentence-floating-bubble')).toBeNull();
  });

  it('locates repeated words and preserves abbreviations, decimals, quotes and long sentences', () => {
    const text = 'Dr. Smith paid 3.5 dollars. “Smith returned!”';
    expect(sentenceAtOffset(text, text.lastIndexOf('Smith'))).toBe('“Smith returned!”');
    expect(sentenceAtOffset(text, text.indexOf('paid'))).toBe('Dr. Smith paid 3.5 dollars.');
    const longSentence = 'word '.repeat(250) + 'ends.';
    expect(sentenceAtOffset(longSentence, 20)).toBe(longSentence);
  });

  it('translates only the held sentence and reuses its translation after closing', async () => {
    jest.mocked(requestSentenceTranslation).mockResolvedValue('鸟儿飞翔。');
    const lookupWord = jest.fn();
    const view = await render(<InteractiveWordParagraph text="Birds fly. Fish swim." targetColor="#123456" lookupWord={lookupWord} />);
    await fireEvent(view.getByText('Birds'), 'longPress');
    await waitFor(() => expect(view.getByText('鸟儿飞翔。')).toBeTruthy());
    expect(requestSentenceTranslation).toHaveBeenCalledWith('Birds fly.');
    expect(lookupWord).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('关闭单句翻译'));
    await fireEvent(view.getByText('fly'), 'longPress');
    expect(view.getByText('鸟儿飞翔。')).toBeTruthy();
    expect(requestSentenceTranslation).toHaveBeenCalledTimes(1);
  });

  it('ignores a late translation after changing sentences and allows retry', async () => {
    let resolveFirst!: (value: string) => void;
    jest.mocked(requestSentenceTranslation).mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('鱼儿游泳。');
    const view = await render(<InteractiveWordParagraph text="Birds fly. Fish swim." targetColor="#123456" />);
    await fireEvent(view.getByText('Birds'), 'longPress');
    await fireEvent(view.getByText('Fish'), 'longPress');
    await act(async () => resolveFirst('旧译文'));
    expect(view.queryByText('旧译文')).toBeNull();
    await fireEvent.press(view.getByText('暂时无法翻译这个句子 · 重试'));
    await waitFor(() => expect(view.getByText('鱼儿游泳。')).toBeTruthy());
  });
});

describe('floating word cards', () => {
  it('positions outside prose and replaces cards across paragraphs without allowing late results to reopen them', async () => {
    let resolveFirst!: (value: string) => void;
    const firstLookup = jest.fn().mockImplementation(() => new Promise<string>((resolve) => { resolveFirst = resolve; }));
    const secondLookup = jest.fn().mockResolvedValue('游泳');
    const view = await render(
      <ReadingOverlayProvider>
        <InteractiveWordParagraph text="Birds fly." targetColor="#123456" lookupWord={firstLookup} />
        <InteractiveWordParagraph text="Fish swim." targetColor="#123456" lookupWord={secondLookup} />
      </ReadingOverlayProvider>,
    );
    await fireEvent.press(view.getByText('Birds'), { nativeEvent: { pageX: 140, pageY: 120 } });
    expect(view.getByTestId('word-floating-bubble')).toHaveStyle({ position: 'absolute', top: 138 });
    await fireEvent.press(view.getByText('swim'), { nativeEvent: { pageX: 150, pageY: 180 } });
    await waitFor(() => expect(view.getByText('游泳')).toBeTruthy());
    expect(view.getAllByLabelText('关闭词义提示')).toHaveLength(1);
    expect(view.getByTestId('word-floating-bubble')).toHaveStyle({ top: 198 });
    await act(async () => resolveFirst('鸟儿'));
    expect(view.queryByText('鸟儿')).toBeNull();
    await fireEvent.press(view.getByLabelText('关闭词义提示'));
    expect(view.queryByTestId('word-floating-bubble')).toBeNull();
  });
});
