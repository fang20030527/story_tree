import AsyncStorage from '@react-native-async-storage/async-storage';

const TARGET_COUNT_KEY = 'context_reader_practice_target_count_v1';
export const DEFAULT_TARGET_COUNT = 10;
export const MAX_TARGET_COUNT = 32;

export function parseTargetCount(value: string): number | null {
  if (!/^\d+$/u.test(value.trim())) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 && count <= MAX_TARGET_COUNT ? count : null;
}

export async function loadPracticeTargetCount(): Promise<number> {
  const stored = await AsyncStorage.getItem(TARGET_COUNT_KEY);
  if (stored === null) return DEFAULT_TARGET_COUNT;
  const oldCount = Number(stored);
  return parseTargetCount(stored)
    ?? (Number.isSafeInteger(oldCount) && oldCount > MAX_TARGET_COUNT ? MAX_TARGET_COUNT : DEFAULT_TARGET_COUNT);
}

export async function savePracticeTargetCount(count: number): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_TARGET_COUNT) {
    throw new Error(`请输入 1–${MAX_TARGET_COUNT} 的整数`);
  }
  await AsyncStorage.setItem(TARGET_COUNT_KEY, String(count));
}
