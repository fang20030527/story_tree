import { createEmptyCard, fsrs, Rating, type Card, type CardInput } from 'ts-fsrs';

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false });
const DAY_MS = 86_400_000;
export const REVIEW_MODEL_VERSION = 1;

export interface ReviewEvidence {
  answerId: string;
  practiceId: string;
  vocabularyItemId: string;
  submittedAt: Date;
  isCorrect: boolean;
  wasAssisted: boolean;
  wordHint: boolean;
}

export type ReviewOutcome = 'independent' | 'failed' | 'translated';
export interface ConsolidatedReview {
  practiceId: string;
  vocabularyItemId: string;
  reviewedAt: string;
  outcome: ReviewOutcome;
  wasAssisted: boolean;
}

export interface WordReviewState {
  version: number;
  answerCount: number;
  card: Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string };
  nextReviewAt: string;
  practiceCount: number;
  independentCorrectCount: number;
  assistedCount: number;
  lastPracticedAt: string | null;
  lastOutcome: ReviewOutcome | null;
  lastFailedContextId: string | null;
}

function outcome(evidence: ReviewEvidence): ReviewOutcome {
  if (!evidence.isCorrect || evidence.wordHint) return 'failed';
  return evidence.wasAssisted ? 'translated' : 'independent';
}

export function consolidateReviews(evidence: readonly ReviewEvidence[]): ConsolidatedReview[] {
  const groups = new Map<string, ReviewEvidence[]>();
  for (const entry of evidence) {
    const group = groups.get(entry.practiceId) ?? [];
    group.push(entry);
    groups.set(entry.practiceId, group);
  }
  const severity = { independent: 0, translated: 1, failed: 2 };
  return [...groups.entries()].map(([practiceId, entries]) => {
    const sorted = [...entries].sort((a, b) =>
      severity[outcome(b)] - severity[outcome(a)] ||
      b.submittedAt.getTime() - a.submittedAt.getTime() || a.answerId.localeCompare(b.answerId),
    );
    const weakest = sorted[0]!;
    return {
      practiceId,
      vocabularyItemId: weakest.vocabularyItemId,
      reviewedAt: new Date(Math.max(...entries.map((e) => e.submittedAt.getTime()))).toISOString(),
      outcome: outcome(weakest),
      wasAssisted: entries.some((e) => e.wasAssisted || e.wordHint),
    };
  }).sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.practiceId.localeCompare(b.practiceId));
}

function serializeCard(card: Card): WordReviewState['card'] {
  const { due, last_review, ...rest } = card;
  return { ...rest, due: due.toISOString(), ...(last_review ? { last_review: last_review.toISOString() } : {}) };
}

export function replayReviews(evidence: readonly ReviewEvidence[], createdAt: Date): WordReviewState {
  let card = createEmptyCard(createdAt);
  let nextReviewAt = createdAt;
  const state: WordReviewState = {
    version: REVIEW_MODEL_VERSION, answerCount: evidence.length,
    card: serializeCard(card), nextReviewAt: createdAt.toISOString(),
    practiceCount: 0, independentCorrectCount: 0, assistedCount: 0,
    lastPracticedAt: null, lastOutcome: null, lastFailedContextId: null,
  };
  for (const review of consolidateReviews(evidence)) {
    const reviewedAt = new Date(review.reviewedAt);
    if (review.outcome === 'translated') {
      const tomorrow = new Date(reviewedAt.getTime() + DAY_MS);
      nextReviewAt = nextReviewAt <= reviewedAt ? tomorrow : new Date(Math.min(+nextReviewAt, +tomorrow));
    } else {
      card = scheduler.next(card, reviewedAt, review.outcome === 'failed' ? Rating.Again : Rating.Good).card;
      nextReviewAt = card.due;
    }
    state.practiceCount += 1;
    state.independentCorrectCount += Number(review.outcome === 'independent');
    state.assistedCount += Number(review.wasAssisted);
    state.lastPracticedAt = review.reviewedAt;
    state.lastOutcome = review.outcome;
    if (review.outcome === 'failed') state.lastFailedContextId = review.vocabularyItemId;
  }
  return { ...state, card: serializeCard(card), nextReviewAt: nextReviewAt.toISOString() };
}

export function reviewPriority(state: WordReviewState, now: Date) {
  const due = Date.parse(state.nextReviewAt);
  const group = due > +now ? 2 : state.practiceCount === 0 ? 0 : 1;
  const retrievability = state.card.last_review
    ? scheduler.get_retrievability(state.card as CardInput, now, false)
    : 0;
  return { group, retrievability, due };
}
