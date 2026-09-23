import { describe, expect, it } from 'vitest';

import { planTopicTargets, type TopicTargetCandidate } from './topic-targets';

const candidate = (id: string, wordKey = id, meaningKey = id): TopicTargetCandidate => ({
  id, wordKey, meaningKey,
});

describe('four-topic target allocation', () => {
  it('covers a large selection once across four articles with multiple questions each', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => candidate(`word-${index}`));
    const buckets = planTopicTargets(candidates.map((item) => item.id), candidates);
    expect(buckets).toHaveLength(4);
    expect(buckets.map((bucket) => bucket.length)).toEqual([8, 8, 7, 7]);
    expect(new Set(buckets.flat())).toEqual(new Set(candidates.map((item) => item.id)));
  });

  it('keeps two distinct quiz words in every article when only two are selected', () => {
    const buckets = planTopicTargets(['bank', 'river'], [candidate('bank'), candidate('river')]);
    expect(buckets).toHaveLength(4);
    expect(buckets.every((bucket) => new Set(bucket).size === 2)).toBe(true);
  });

  it('puts different meanings of the same word in different articles', () => {
    const candidates = [
      candidate('bank-finance', 'bank', '银行'),
      candidate('bank-river', 'bank', '河岸'),
      candidate('river', 'river', '河流'),
      candidate('bank-old', 'bank', '银行'),
    ];
    const buckets = planTopicTargets(['bank-finance', 'river'], candidates);
    expect(buckets.some((bucket) => bucket.includes('bank-finance'))).toBe(true);
    expect(buckets.some((bucket) => bucket.includes('bank-river'))).toBe(true);
    expect(buckets.every((bucket) => !(bucket.includes('bank-finance') && bucket.includes('bank-river')))).toBe(true);
    expect(buckets.flat()).not.toContain('bank-old');
  });

  it('repeats a sole word when it is the only available quiz word', () => {
    expect(planTopicTargets(['only'], [candidate('only')])).toEqual([
      ['only'], ['only'], ['only'], ['only'],
    ]);
  });

  it('rejects more than four requested senses of one word', () => {
    const candidates = Array.from({ length: 5 }, (_, index) => candidate(`sense-${index}`, 'bank', `义项${index}`));
    expect(() => planTopicTargets(candidates.map((item) => item.id), candidates))
      .toThrow('同一单词最多可在四篇短文中练习四种释义');
  });
});
