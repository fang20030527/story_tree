import { AppError } from '../../core/errors';

export const TOPIC_ARTICLE_COUNT = 4;
export const MAX_TOPIC_WORDS = 32;
export const MAX_TARGETS_PER_ARTICLE = 10;

export interface TopicTargetCandidate {
  id: string;
  wordKey: string;
  meaningKey: string;
}

/** Cover the requested meanings first, then spread other senses and fill thin articles. */
export function planTopicTargets(
  selectedIds: readonly string[],
  candidates: readonly TopicTargetCandidate[],
): string[][] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected = selectedIds.map((id) => byId.get(id));
  if (selected.length === 0 || selected.some((candidate) => !candidate)) {
    throw new AppError('INTERNAL_ERROR', '练习目标不存在', 500, true);
  }
  const primary = selected as TopicTargetCandidate[];
  const distinctWords = new Set(primary.map((candidate) => candidate.wordKey));
  if (distinctWords.size > MAX_TOPIC_WORDS) {
    throw new AppError('VALIDATION_ERROR', `四篇短文最多可选 ${MAX_TOPIC_WORDS} 个词`, 400);
  }

  const buckets = Array.from({ length: TOPIC_ARTICLE_COUNT }, () => [] as TopicTargetCandidate[]);
  const containsWord = (index: number, wordKey: string) => buckets[index]!.some((item) => item.wordKey === wordKey);
  const add = (candidate: TopicTargetCandidate, cursor: number): number | null => {
    const eligible = buckets.map((bucket, index) => ({ index, size: bucket.length }))
      .filter(({ index, size }) => size < MAX_TARGETS_PER_ARTICLE && !containsWord(index, candidate.wordKey))
      .sort((left, right) => left.size - right.size
        || (left.index - cursor + TOPIC_ARTICLE_COUNT) % TOPIC_ARTICLE_COUNT
          - (right.index - cursor + TOPIC_ARTICLE_COUNT) % TOPIC_ARTICLE_COUNT);
    const index = eligible[0]?.index;
    if (index === undefined) return null;
    buckets[index]!.push(candidate);
    return index;
  };

  let cursor = 0;
  for (const candidate of primary) {
    const index = add(candidate, cursor);
    if (index === null) {
      throw new AppError('VALIDATION_ERROR', '同一单词最多可在四篇短文中练习四种释义', 400);
    }
    cursor = (index + 1) % TOPIC_ARTICLE_COUNT;
  }

  const selectedWordOrder = [...distinctWords];
  const usedIds = new Set(primary.map((candidate) => candidate.id));
  for (const wordKey of selectedWordOrder) {
    const usedMeanings = new Set(primary.filter((item) => item.wordKey === wordKey)
      .map((item) => item.meaningKey));
    for (const candidate of candidates) {
      if (candidate.wordKey !== wordKey || usedIds.has(candidate.id)
        || usedMeanings.has(candidate.meaningKey)) continue;
      const index = add(candidate, 0);
      if (index === null) break;
      usedIds.add(candidate.id);
      usedMeanings.add(candidate.meaningKey);
    }
  }

  const desiredMinimum = Math.min(2, distinctWords.size);
  for (let index = 0; index < buckets.length; index += 1) {
    while (buckets[index]!.length < desiredMinimum) {
      const candidate = primary.find((item) => !containsWord(index, item.wordKey));
      if (!candidate) break;
      buckets[index]!.push(candidate);
    }
  }
  if (distinctWords.size === 1) {
    for (const bucket of buckets) {
      if (!bucket.length) bucket.push(primary[0]!);
    }
  }

  return buckets.map((bucket) => bucket.map((candidate) => candidate.id));
}
