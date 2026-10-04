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

  it('lets only the first question of a target decide the review; later questions only reinforce', () => {
    const later = new Date('2026-09-01T10:03:00Z');
    const first = evidence();
    const missedAgain = evidence({ answerId: 'answer-2', submittedAt: later, isCorrect: false, round: 1 });
    const result = replayReviews([first, missedAgain], start);
    const alone = replayReviews([first], start);
    // Missing a later question after the first answer's feedback changes nothing in the schedule...
    expect(result.card).toEqual(alone.card);
    expect(result.nextReviewAt).toBe(alone.nextReviewAt);
    expect(result.practiceCount).toBe(1);
    expect(result.independentCorrectCount).toBe(1);
    expect(result.lastOutcome).toBe('independent');
    // ...but every stored answer is still counted, which the consistency checks compare with the answers table.
    expect(result.answerCount).toBe(2);
    expect(alone.answerCount).toBe(1);
    // A first question answered wrongly still fails the word, whatever the later ones show.
    const failed = replayReviews([evidence({ isCorrect: false }), evidence({ answerId: 'answer-3', submittedAt: later, round: 1 })], start);
    expect(failed.lastOutcome).toBe('failed');
    expect(failed.card).toEqual(replayReviews([evidence({ isCorrect: false })], start).card);
  });

  it('treats an answer without a round as the first question', () => {
    expect(replayReviews([evidence({ round: 0 })], start)).toEqual(replayReviews([evidence()], start));
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

  it('未练习新词不因数据库时间略超前而进入未到时间分组', () => {
    const createdAt = new Date(+start + 1_000);
    const fresh = replayReviews([], createdAt);
    expect(reviewPriority(fresh, start).group).toBe(0);
    expect(fresh.nextReviewAt).toBe(createdAt.toISOString());
  });
});
