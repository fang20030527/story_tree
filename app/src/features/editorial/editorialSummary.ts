import AsyncStorage from '@react-native-async-storage/async-storage';

import { requestSentenceTranslation } from '@/api/sentences';

const CACHE_PREFIX = 'context_reader_editorial_summary_v1_';
const pending = new Map<string, Promise<string>>();

export function isChineseEditorialSummary(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

export async function getChineseEditorialSummary(articleId: string, source: string): Promise<string> {
  if (isChineseEditorialSummary(source)) return source;
  const cacheKey = CACHE_PREFIX + articleId;
  const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (cached) {
    try {
      const value: unknown = JSON.parse(cached);
      if (value && typeof value === 'object' && 'source' in value && 'summaryZh' in value
        && value.source === source && typeof value.summaryZh === 'string'
        && isChineseEditorialSummary(value.summaryZh)) {
        return value.summaryZh;
      }
    } catch { /* 无效缓存会重新翻译。 */ }
  }

  const key = `${articleId}:${source}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const summaryZh = (await requestSentenceTranslation(source)).trim();
    if (!isChineseEditorialSummary(summaryZh)) throw new Error('中文概述无效');
    await AsyncStorage.setItem(cacheKey, JSON.stringify({ source, summaryZh }))
      .catch(() => undefined);
    return summaryZh;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}
