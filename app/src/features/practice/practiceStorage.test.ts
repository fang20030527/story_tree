import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreatePracticeRequest } from '@context-reader/contracts';

import { createIdempotencyKey } from '@/api/installation';
import { PRACTICE_DRAFT_KEY } from '@/api/storage';

import {
  PendingCreateOperationError,
  prepareCreatePracticeOperation,
} from './practiceStorage';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);
jest.mock('@/api/installation', () => ({
  createIdempotencyKey: jest.fn(),
}));

const mockedCreateIdempotencyKey = jest.mocked(createIdempotencyKey);
const request: CreatePracticeRequest = {
  items: [{ term: 'resilient', meaningZh: '有韧性的' }],
};

describe('practice creation storage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockedCreateIdempotencyKey.mockResolvedValue('a'.repeat(32));
  });

  it('retains one operation key when the same submission is retried', async () => {
    const first = await prepareCreatePracticeOperation(request);
    const retry = await prepareCreatePracticeOperation(request);

    expect(retry).toEqual(first);
    expect(mockedCreateIdempotencyKey).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(PRACTICE_DRAFT_KEY)).resolves.toBe(
      JSON.stringify([
        { term: 'resilient', meaningZh: '有韧性的', sourceSentence: '' },
      ]),
    );
  });

  it('does not reuse a pending key for changed request material', async () => {
    await prepareCreatePracticeOperation(request);

    await expect(prepareCreatePracticeOperation({
      items: [{ term: 'resilient', meaningZh: '恢复力强的' }],
    })).rejects.toBeInstanceOf(PendingCreateOperationError);
    expect(mockedCreateIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});
