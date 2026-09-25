import AsyncStorage from '@react-native-async-storage/async-storage';

import { requestSentenceTranslation } from '@/api/sentences';

import { getChineseEditorialSummary } from './editorialSummary';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/api/sentences', () => ({ requestSentenceTranslation: jest.fn() }));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it('translates English summaries once and reuses a source-matched local cache', async () => {
  jest.mocked(requestSentenceTranslation).mockResolvedValue('最新的关税威胁与贸易战风险。');
  const source = 'His latest tariff threats are proportionate. But the situation could get out of hand';
  await expect(getChineseEditorialSummary('mark-carney', source))
    .resolves.toBe('最新的关税威胁与贸易战风险。');
  await expect(getChineseEditorialSummary('mark-carney', source))
    .resolves.toBe('最新的关税威胁与贸易战风险。');
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(1);
  expect(requestSentenceTranslation).toHaveBeenCalledWith(source);
});

it('refreshes an edited source and rejects responses without Chinese text', async () => {
  jest.mocked(requestSentenceTranslation).mockResolvedValueOnce('旧中文概述。').mockResolvedValueOnce('English only');
  await getChineseEditorialSummary('article', 'Old summary');
  await expect(getChineseEditorialSummary('article', 'New summary')).rejects.toThrow('中文概述无效');
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(2);
});

it('keeps an already Chinese summary available offline', async () => {
  await expect(getChineseEditorialSummary('article', '文章讨论人工智能安全。'))
    .resolves.toBe('文章讨论人工智能安全。');
  expect(requestSentenceTranslation).not.toHaveBeenCalled();
});
