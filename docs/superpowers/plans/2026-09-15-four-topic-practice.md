# Four Topic Practice Implementation Plan

> Execute inline in this existing feature checkout, retaining the user's uncommitted work.

**Goal:** Generate four short articles and let the reader choose their order.

**Architecture:** Four independent sessions share a group ID. Existing read/answer/translation paths remain authoritative for each article; group summaries drive selection and polling. Independent generation jobs settle a single quota reservation after all members finish.

**Tech Stack:** Expo Router, React Native, Zod, Fastify, Drizzle/PostgreSQL, Vitest, Jest.

## Global Constraints

- Four distinct topics from economy, culture, politics, technology, education, environment, society.
- Each new short article contains 200–300 English words.
- Preserve old single-article requests and stored records.
- Never navigate automatically from generation to an article in a topic group.

## Tasks

- [x] Contracts and persistence: add optional `format: 'topic_set'` to creation requests; nullable group ID/topic/position columns and group summaries on PracticeDto. Generate a forward migration. Create four sessions and four jobs in the existing idempotent transaction, reserving quota once.
- [x] Generation: select four topics using a random permutation; pass topic to generation and verification; validate short length when topic exists. Keep legacy 700–1000-word validation. Lock group root before member transitions; settle quota only after all members reach terminal states. Extend fake provider for short fixtures.
- [x] UI: opt into the new format from both creation screens; group-aware polling; add four-card selection screen with loading, failure, title, word count and progress. Route generation and completion back to selection. Preserve per-session reading storage.
- [x] Validation: integration tests create and replay a group, generate all members, check summaries and independent answers; reject foreign reads; assert single quota commit/all-failed release. Component tests verify no automatic reading navigation and selecting different cards. Run typecheck, affected tests, lint, then workspace regression tests.

Commands: `npm run db:generate --workspace=@context-reader/server`, `npm run typecheck`, `npm test`, `npm run lint`.


## Validation results

- App: all 41 suites / 157 tests passed; final topic navigation and sibling polling checks passed again after the storage-error retry adjustment.
- Server: new topic-group, legacy generation and length-validation suites passed (19 tests in the initial run); create/get/AI-provider regression suites passed (30 tests).
- Contracts: 25 tests passed.
- Workspace typecheck and lint passed (16 pre-existing test import warnings, no errors).
- Server build and Expo Web production export passed, including the new `/practice/[id]/topics` route.
- Applied migration 0006 using the existing project migration runner; only this migration was pending.
- Generation integration tests use FakeAiProvider and isolated PostgreSQL schemas; no paid live AI generation was performed.
