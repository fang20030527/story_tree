import AsyncStorage from '@react-native-async-storage/async-storage';

export interface EditorialReadingProgress {
  addedWords: string[];
  scrollY: number;
  showFullTranslation: boolean;
}

const PREFIX = 'context_reader_editorial_progress_v1_';
const writes = new Map<string, Promise<void>>();

async function read(articleId: string): Promise<EditorialReadingProgress> {
  const raw = await AsyncStorage.getItem(PREFIX + articleId);
  let value: Partial<EditorialReadingProgress> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') value = parsed;
  } catch { /* 损坏的本地记录按首次阅读处理。 */ }
  return {
    addedWords: Array.isArray(value.addedWords)
      ? [...new Set(value.addedWords.filter((word): word is string => typeof word === 'string')
        .map((word) => word.trim().toLocaleLowerCase('en-US')).filter(Boolean))]
      : [],
    scrollY: typeof value.scrollY === 'number' && Number.isFinite(value.scrollY)
      ? Math.max(0, value.scrollY) : 0,
    showFullTranslation: value.showFullTranslation === true,
  };
}

export async function loadEditorialReadingProgress(articleId: string) {
  await writes.get(articleId);
  return read(articleId);
}

export function saveEditorialReadingProgress(
  articleId: string,
  patch: Partial<EditorialReadingProgress>,
): Promise<void> {
  // 按文章串行合并，避免滚动保存覆盖稍后返回的生词高亮。
  const write = (writes.get(articleId) ?? Promise.resolve()).then(async () => {
    const current = await read(articleId);
    const next = {
      ...current,
      ...patch,
      addedWords: [...new Set([...current.addedWords, ...(patch.addedWords ?? [])]
        .map((word) => word.trim().toLocaleLowerCase('en-US')).filter(Boolean))],
    };
    await AsyncStorage.setItem(PREFIX + articleId, JSON.stringify(next));
  });
  const settled = write.catch(() => undefined);
  writes.set(articleId, settled);
  void settled.then(() => {
    if (writes.get(articleId) === settled) writes.delete(articleId);
  });
  return write;
}
