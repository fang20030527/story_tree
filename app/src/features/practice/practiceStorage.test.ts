import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreatePracticeRequest } from '@context-reader/contracts';

import { createIdempotencyKey } from '@/api/installation';
import {
  CREATE_PRACTICE_OPERATION_KEY,
  PRACTICE_DRAFT_KEY,
} from '@/api/storage';

import {
  PendingCreateOperationError,
  clearReadyPracticeCreation,
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

  it('reuses a legacy pending payload when the new UI requests a topic group', async () => {
    const oldOperation = await prepareCreatePracticeOperation(request);
    const resumed = await prepareCreatePracticeOperation({ ...request, format: 'topic_set' });
    expect(resumed).toEqual(oldOperation);
    expect(resumed.request.format).toBeUndefined();
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

  it('retains a random vocabulary request without replacing the manual draft', async () => {
    await AsyncStorage.setItem(PRACTICE_DRAFT_KEY, 'existing-draft');

    const first = await prepareCreatePracticeOperation({
      source: 'vocabulary',
      targetCount: 16,
    });
    const retry = await prepareCreatePracticeOperation({
      source: 'vocabulary',
      targetCount: 16,
    });

    expect(retry).toEqual(first);
    expect(mockedCreateIdempotencyKey).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(PRACTICE_DRAFT_KEY)).resolves.toBe(
      'existing-draft',
    );
  });

  it('preserves a manual draft after a random vocabulary practice is ready', async () => {
    await AsyncStorage.setItem(PRACTICE_DRAFT_KEY, 'existing-draft');
    await prepareCreatePracticeOperation({
      source: 'vocabulary',
      targetCount: 10,
    });

    await clearReadyPracticeCreation();

    await expect(AsyncStorage.getItem(PRACTICE_DRAFT_KEY)).resolves.toBe(
      'existing-draft',
    );
    await expect(
      AsyncStorage.getItem(CREATE_PRACTICE_OPERATION_KEY),
    ).resolves.toBeNull();
  });

  it('clears the submitted draft after a manual practice is ready', async () => {
    await prepareCreatePracticeOperation(request);

    await clearReadyPracticeCreation();

    await expect(AsyncStorage.getItem(PRACTICE_DRAFT_KEY)).resolves.toBeNull();
    await expect(
      AsyncStorage.getItem(CREATE_PRACTICE_OPERATION_KEY),
    ).resolves.toBeNull();
  });
});
