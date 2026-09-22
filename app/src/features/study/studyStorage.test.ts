import AsyncStorage from '@react-native-async-storage/async-storage';
import { calendarDays, loadStudyTotals, localDateKey, recordStudyInterval } from './studyStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/features/auth/authStorage', () => ({ loadAuthUser: jest.fn(async () => ({ userId: 'reader' })) }));

beforeEach(async () => { await AsyncStorage.clear(); });

it('累计阅读和自测的并发保存，并在刷新时等待保存完成', async () => {
  const start = new Date(2026, 8, 22, 12).getTime();
  const key = Promise.resolve('study-time:v1:reader');
  const reading = recordStudyInterval(key, start, start + 60_000);
  const quiz = recordStudyInterval(key, start + 60_000, start + 90_000);
  expect(await loadStudyTotals()).toEqual({ '2026-09-22': 90_000 });
  await Promise.all([reading, quiz]);
});

it('按本地午夜拆分跨月学习时长', async () => {
  await recordStudyInterval(Promise.resolve('study-time:v1:reader'),
    new Date(2026, 8, 30, 23, 59, 30).getTime(), new Date(2026, 9, 1, 0, 0, 20).getTime());
  expect(await loadStudyTotals()).toEqual({ '2026-09-30': 30_000, '2026-10-01': 20_000 });
});

it('不同账号不共用学习时长', async () => {
  await recordStudyInterval(Promise.resolve('study-time:v1:another'), 1, 60_001);
  expect(await loadStudyTotals()).toEqual({});
});

it.each([[2026, 8, 22, 35], [2024, 1, 29, 35], [2026, 7, 31, 42], [2026, 1, 1, 28]])(
  '生成真实月份的完整日历 %i-%i', (year, month, day, length) => {
    const now = new Date(year, month, day);
    const days = calendarDays(now);
    expect(days).toHaveLength(length);
    expect(days[0].getDay()).toBe(0);
    expect(days.filter((date) => localDateKey(date) === localDateKey(now))).toHaveLength(1);
    expect(days.filter((date) => date.getMonth() === month)).toHaveLength(new Date(year, month + 1, 0).getDate());
  });
