import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { loadAuthUser } from '@/features/auth/authStorage';

export const DAILY_GOAL_MS = 10 * 60_000;
const TotalsSchema = z.record(z.string(), z.number().finite().nonnegative());
export type StudyTotals = z.infer<typeof TotalsSchema>;
let writes: Promise<void> = Promise.resolve();

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarDays(now: Date): Date[] {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Array.from({ length: Math.ceil((first.getDay() + count) / 7) * 7 },
    (_, index) => new Date(now.getFullYear(), now.getMonth(), 1 - first.getDay() + index));
}

export async function studyStorageKey(): Promise<string> {
  const user = await loadAuthUser();
  return `study-time:v1:${user?.userId ?? 'guest'}`;
}

async function readTotals(key: string): Promise<StudyTotals> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return {};
  return TotalsSchema.parse(JSON.parse(raw));
}

export async function loadStudyTotals(): Promise<StudyTotals> {
  const key = await studyStorageKey();
  await writes;
  return readTotals(key);
}

// 串行保存，避免阅读页退出与自测页进入时覆盖彼此的累计值。
export function recordStudyInterval(key: Promise<string>, start: number, end: number): Promise<void> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return Promise.resolve();
  const save = writes.then(async () => {
    const resolvedKey = await key;
    const totals = await readTotals(resolvedKey);
    let cursor = start;
    while (cursor < end) {
      const date = new Date(cursor);
      const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
      const until = Math.min(end, midnight);
      const day = localDateKey(date);
      totals[day] = (totals[day] ?? 0) + until - cursor;
      cursor = until;
    }
    await AsyncStorage.setItem(resolvedKey, JSON.stringify(totals));
  });
  writes = save.catch(() => undefined);
  return save;
}
