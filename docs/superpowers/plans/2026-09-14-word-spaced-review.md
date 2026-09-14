# Word Spaced Review Implementation Plan

> **For agentic workers:** Use executing-plans to implement the approved design task by task. Steps use checkboxes for tracking.

**Goal:** Count and schedule vocabulary by word, retaining contextual meanings and prioritizing due words.

**Architecture:** Keep vocabulary_items as immutable contextual references. Add word identities and materialized FSRS state derived from first-answer history; use one scheduler and selection service for the list and practice generation. A new word API provides global statistics and server-side filtering.

**Tech Stack:** Expo 57, React Native, Fastify, Drizzle/PostgreSQL, ts-fsrs 5.4.2, Zod, Vitest and Jest.

## Global Constraints

- Follow the approved spec at ../specs/2026-09-14-word-spaced-review-design.md.
- Preserve existing uncommitted reading, pronunciation and translation work.
- Keep contextual IDs, meanings, source sentences and answers; no destructive merge.
- Server UTC time, retention target 0.90, Good for independent success, Again for explicit failure/word hint, no strength increase from translated correct answers.
- One review event per practice and word, including legacy duplicate-meaning targets.
- Test databases use the existing isolated app_test_* schema helper.

## Task 1: Scheduler and word persistence

Files: server/src/modules/vocabulary/scheduler.ts, scheduler.test.ts, word-state.ts, server/src/db/schema.ts, server/drizzle/0005_*.sql and metadata, server/package.json.

Interfaces: scheduler exports createReviewState(now), replayReviews(events, createdAt), reviewPriority(state, now). Events carry practiceId, vocabularyItemId, submittedAt, isCorrect, wordHint and wasAssisted. Word state stores FSRS card JSON, counts, lastPracticedAt, lastOutcome, nextReviewAt and most recent failed context ID.

- [ ] Add pinned dependency with `npm install ts-fsrs@5.4.2 --workspace=@context-reader/server --save-exact`.
- [ ] Test independent success vs Again, translation-only success, duplicate session consolidation, time-based priority, and deterministic replay using fixed timestamps.
- [ ] Implement scheduler using `fsrs({ request_retention: 0.9, enable_fuzz: false })`; all historical events are grouped by practice, selecting the weakest result and latest submission time.
- [ ] Add additive word table and nullable context wordId FK; link every context with a backfill and lazy synchronization for older writers. Serialize updates with a per-user transaction advisory lock.
- [ ] Generate migration with `npm run db:generate --workspace=@context-reader/server`, verify SQL is additive, run scheduler tests and typecheck.

## Task 2: Word state, selection and answers

Files: server/src/modules/vocabulary/word-state.ts, repository.ts; server/src/modules/practice/answer-service.ts, create-service.ts; server/src/modules/dashboard/service.ts.

Interfaces: syncVocabularyWords(tx, userId) returns active word rows with state; loadRankedWords(tx, userId, now) returns globally ranked word entries; selectReviewVocabularyItemIds(tx, userId, count) returns one contextual ID per due word.

- [ ] Rebuild missing/stale word states from answer history, including scoped pre-answer assistance; initialize absent history as new.
- [ ] Refresh affected word state inside the first-answer transaction after answer insertion. Existing idempotency guards remain authoritative.
- [ ] Sort new due words first, due words by retrievability then due/ID, future words by due/ID; select failed context when active, otherwise newest context.
- [ ] Change practice count errors to single-word counts; deduplicate manual practice targets by normalized term.
- [ ] Use word state for dashboard counts; retain legacy API compatibility.
- [ ] Integration-test same-word meanings, failed-context choice, legacy replay, user isolation, retry/concurrent answers and future-word exclusion.

## Task 3: Word API and contracts

Files: packages/contracts/src/index.ts; server/src/modules/vocabulary/word-service.ts, routes.ts; new word-service integration tests.

Interfaces: GET /v1/vocabulary-words?filter=all|due|scheduled&limit=N&cursor=... -> VocabularyWordPage. GET /v1/vocabulary-words/:id/contexts -> VocabularyWordContexts.

- [ ] Add strict word DTO and page/context schemas with wordId, term, meaningZh, sourceSentence, contextCount, reviewReason, nextReviewAt, practiceCount, independentCorrectCount, assistedCount, lastPracticedAt. Page includes items, nextCursor, evaluatedAt, nextRefreshAt and summary {totalCount,dueCount,scheduledCount}.
- [ ] Filter and paginate globally ranked words with a cursor bound to user/filter/evaluation/revision/last word. Return VOCABULARY_CHANGED on stale data.
- [ ] Authorize context expansion with the same user and active-context restriction.
- [ ] Test complete statistics across pages, pagination/filter validation, stale cursor and unauthorized expansion.

## Task 4: Client presentation

Files: app/src/api/practices.ts; app/src/app/(tabs)/words.tsx; app/src/app/practice/from-vocabulary.tsx; app/src/features/practice/wordPresentation.ts and relevant app tests.

Interfaces: getVocabularyWords({filter,cursor,limit}) and getVocabularyWordContexts(wordId) consume Task 3 contracts.

- [ ] Replace per-meaning listing with word API, three filters, server totals and clear reason labels.
- [ ] Expand multiple saved contexts on demand; preserve primary source sentence and recent practice details.
- [ ] Refresh on focus, foreground and server nextRefreshAt. Guard response races on filter/page changes; stale cursors reload first page.
- [ ] Change vocabulary setup copy and errors to prioritized words, including zero-due messaging.
- [ ] Verify filter network requests, global count, context expansion, future date label, failures, pagination and navigation with Jest.

## Task 5: Verify and document

Files: README.md, server/README.md, this plan and the approved spec.

- [ ] Run targeted Vitest/Jest tests, then `npm run check` and `npm run build`; fix regressions caused by the new behavior.
- [ ] Exercise migrations only in an isolated test schema first; verify old context and answer counts survive backfill/replay and re-running it.
- [ ] Document the migration command, lazy history replay, new APIs, scheduling policy and word-count semantics.
- [ ] Review final diff for unrelated changes and report verification results and whether local running services received the migration.
