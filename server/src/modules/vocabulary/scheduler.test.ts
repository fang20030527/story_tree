import { describe, expect, it } from 'vitest';

import { replayReviews, reviewPriority, type ReviewEvidence } from './scheduler';

const start = new Date('2026-09-01T10:00:00Z');
const evidence = (overrides: Partial<ReviewEvidence> = {}): ReviewEvidence => ({
  answerId: 'answer-1', practiceId: 'practice-1', vocabularyItemId: 'meaning-1',
  submittedAt: start, isCorrect: true, wasAssisted: false, wordHint: false,
  ...overrides,
});

describe('word review scheduling', () => {
  it('schedules independent success later than failure or a word hint', () => {
    const success = replayReviews([evidence()], start);
    const failure = replayReviews([evidence({ isCorrect: false })], start);
    const hint = replayReviews([evidence({ wordHint: true, wasAssisted: true })], start);
    expect(Date.parse(success.nextReviewAt)).toBeGreaterThan(Date.parse(failure.nextReviewAt));
    expect(success.independentCorrectCount).toBe(1);
    expect(hint.card).toEqual(failure.card);
    expect(hint.independentCorrectCount).toBe(0);
  });

  it('defers translated success for verification without inventing memory strength', () => {
    const translated = replayReviews([evidence({ wasAssisted: true })], start);
    expect(translated.card.stability).toBe(0);
    expect(translated.nextReviewAt).toBe('2026-09-02T10:00:00.000Z');
    expect(translated.practiceCount).toBe(1);
    expect(translated.independentCorrectCount).toBe(0);
    expect(reviewPriority(translated, start).group).toBe(2);
  });

  it('consolidates legacy meanings in one practice using the weakest result', () => {
    const at = new Date('2026-09-01T10:02:00Z');
    const reviews = [evidence(), evidence({ answerId: 'answer-2', vocabularyItemId: 'meaning-2', submittedAt: at, isCorrect: false })];
    const result = replayReviews(reviews, start);
    expect(result.practiceCount).toBe(1);
    expect(result.independentCorrectCount).toBe(0);
    expect(result.lastFailedContextId).toBe('meaning-2');
    expect(result.card).toEqual(replayReviews([reviews[1]!], start).card);
    expect(replayReviews([...reviews].reverse(), start)).toEqual(result);
  });

  it('replays distinct sessions and ranks new, forgotten and future words', () => {
    const fresh = replayReviews([], start);
    const practiced = replayReviews([evidence()], start);
    const later = new Date('2026-09-20T10:00:00Z');
    expect(reviewPriority(fresh, later).group).toBe(0);
    expect(reviewPriority(practiced, start).group).toBe(2);
    expect(reviewPriority(practiced, later).group).toBe(1);
    expect(reviewPriority(practiced, later).retrievability).toBeLessThan(
      reviewPriority(practiced, new Date(practiced.nextReviewAt)).retrievability,
    );
    const reinforced = replayReviews([evidence(), evidence({ answerId: 'a2', practiceId: 'p2', submittedAt: new Date('2026-09-04T10:00:00Z') })], start);
    expect(reinforced.practiceCount).toBe(2);
    expect(reinforced.card.stability).toBeGreaterThan(practiced.card.stability);
  });
});
