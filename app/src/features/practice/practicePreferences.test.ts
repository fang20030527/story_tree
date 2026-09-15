import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadPracticeTargetCount, parseTargetCount, savePracticeTargetCount } from './practicePreferences';
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await AsyncStorage.clear(); });
it('defaults to ten and persists a custom count', async () => {
  await expect(loadPracticeTargetCount()).resolves.toBe(10);
  await savePracticeTargetCount(30);
  await expect(loadPracticeTargetCount()).resolves.toBe(30);
});
it.each(['', '0', '-1', '1.5', 'abc', '9007199254740992'])('rejects invalid count %s', (value) => {
  expect(parseTargetCount(value)).toBeNull();
});
