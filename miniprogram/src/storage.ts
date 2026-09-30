import { dateKey } from './model';

type User = { userId?: string; email?: string };
export function user(): User { return wx.getStorageSync('bhe:user') as User || {}; }
export function localKey(name: string) { return `bhe:local:${user().userId ?? 'guest'}:${name}`; }
export function readLocal<T>(name: string, fallback: T): T {
  const value: unknown = wx.getStorageSync(localKey(name));
  return value === '' || value === undefined || value === null ? fallback : value as T;
}
export function writeLocal(name: string, value: unknown) { wx.setStorageSync(localKey(name), value); }
export function recordStudy(start: number, end = Date.now()) {
  if (!Number.isFinite(start) || end <= start) return;
  const totals = readLocal<Record<string, number>>('study', {});
  const capped = Math.min(end, start + 300_000);
  let cursor = start;
  while (cursor < capped) {
    const date = new Date(cursor), boundary = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const until = Math.min(capped, boundary), key = dateKey(date);
    totals[key] = (totals[key] ?? 0) + until - cursor; cursor = until;
  }
  writeLocal('study', totals);
}
