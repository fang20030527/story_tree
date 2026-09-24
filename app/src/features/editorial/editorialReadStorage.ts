import AsyncStorage from '@react-native-async-storage/async-storage';

import { getEditorialArticle } from './catalog';
import { isRemoteEditorialId } from './remoteCatalog';

const KEY_PREFIX = 'context_reader_editorial_read_v1_';
const listeners = new Set<(articleId: string) => void>();

export async function isEditorialArticleRead(articleId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_PREFIX + articleId)) === 'true';
}

export async function markEditorialArticleRead(articleId: string): Promise<void> {
  if (!getEditorialArticle(articleId) && !isRemoteEditorialId(articleId)) throw new Error('文章不存在');
  await AsyncStorage.setItem(KEY_PREFIX + articleId, 'true');
  listeners.forEach((listener) => listener(articleId));
}

export function subscribeEditorialRead(listener: (articleId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
