import AsyncStorage from '@react-native-async-storage/async-storage';

const TARGET_COUNT_KEY = 'context_reader_practice_target_count_v1';
export const DEFAULT_TARGET_COUNT = 10;

export function parseTargetCount(value: string): number | null {
  if (!/^\d+$/u.test(value.trim())) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export async function loadPracticeTargetCount(): Promise<number> {
  const stored = await AsyncStorage.getItem(TARGET_COUNT_KEY);
  return stored === null ? DEFAULT_TARGET_COUNT : parseTargetCount(stored) ?? DEFAULT_TARGET_COUNT;
}

export async function savePracticeTargetCount(count: number): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('请输入大于 0 的整数');
  await AsyncStorage.setItem(TARGET_COUNT_KEY, String(count));
}
