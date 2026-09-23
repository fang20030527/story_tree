import AsyncStorage from '@react-native-async-storage/async-storage';

import { requestSentenceTranslation } from '@/api/sentences';

const CACHE_PREFIX = 'context_reader_editorial_translation_v1_';
const MAX_CHUNK_LENGTH = 3_000;

function sourceText(paragraphs: readonly string[]): string {
  return paragraphs.join('\n\n');
}

export async function loadEditorialTranslation(
  articleId: string,
  paragraphs: readonly string[],
): Promise<string | null> {
  const raw = await AsyncStorage.getItem(CACHE_PREFIX + articleId);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && 'sourceText' in value
      && 'translatedTextZh' in value
      && value.sourceText === sourceText(paragraphs)
      && typeof value.translatedTextZh === 'string'
      && /\p{Script=Han}/u.test(value.translatedTextZh)) {
      return value.translatedTextZh;
    }
  } catch { /* A damaged cache is regenerated on demand. */ }
  return null;
}

export async function saveEditorialTranslation(
  articleId: string,
  paragraphs: readonly string[],
  translatedTextZh: string,
): Promise<void> {
  await AsyncStorage.setItem(CACHE_PREFIX + articleId, JSON.stringify({
    sourceText: sourceText(paragraphs), translatedTextZh,
  }));
}

/** Keep requests bounded while preserving source order and paragraph boundaries. */
export function splitEditorialTranslationChunks(paragraphs: readonly string[]): string[] {
  const chunks: string[] = [];
  let current = '';
  const append = (piece: string) => {
    if (!piece) return;
    const next = current ? `${current}\n\n${piece}` : piece;
    if (next.length > MAX_CHUNK_LENGTH && current) {
      chunks.push(current);
      current = piece;
    } else {
      current = next;
    }
  };

  for (const paragraph of paragraphs) {
    let remaining = paragraph.trim();
    while (remaining.length > MAX_CHUNK_LENGTH) {
      const boundary = remaining.lastIndexOf(' ', MAX_CHUNK_LENGTH);
      const end = boundary > MAX_CHUNK_LENGTH / 2 ? boundary : MAX_CHUNK_LENGTH;
      append(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    append(remaining);
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function requestEditorialTranslation(
  paragraphs: readonly string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<string> {
  const chunks = splitEditorialTranslationChunks(paragraphs);
  if (!chunks.length) throw new Error('文章正文为空');
  const translations: string[] = [];
  // Limit concurrent AI requests while returning complete results in source order.
  for (let index = 0; index < chunks.length; index += 2) {
    const batch = chunks.slice(index, index + 2);
    translations.push(...await Promise.all(batch.map(requestSentenceTranslation)));
    onProgress?.(translations.length, chunks.length);
  }
  return translations.join('\n\n');
}
