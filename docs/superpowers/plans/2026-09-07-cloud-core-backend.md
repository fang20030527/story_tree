# Cloud Core Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and connect the first cloud-backed vocabulary-practice vertical slice: anonymous 14+ identity, Neon persistence, resilient EvoLink generation and translation, first-attempt quizzes, progress, and the minimum Expo screens needed to use it.

**Architecture:** Keep the existing Expo SDK 54 application in `app/`, add a standalone Fastify modular monolith in `server/`, and share runtime-validated DTOs through `packages/contracts/`. API and worker logic share domain modules; PostgreSQL provides both the system of record and a lease-based task queue, while the mobile client polls durable resource state.

**Tech Stack:** Node.js 22.13+, TypeScript 5.9.2, Fastify 5.12.3, Zod 4.5.4, Drizzle ORM 0.45.2, PostgreSQL/Neon through `pg` 8.23.0, Vitest 5.0.0 for server/contracts, Jest 30.5.1 with Jest Expo 54.0.18 for the client, Expo SDK 54, React Native 0.81.5.

**Approved design:** `docs/superpowers/specs/2026-09-07-cloud-core-backend-design.md`

## Global Constraints

- Keep the Expo client on SDK 54; upgrading Expo, React, or React Native is outside this plan.
- Keep every EvoLink credential and `DATABASE_URL` on the server; the app may contain only `EXPO_PUBLIC_API_BASE_URL`.
- Accept 1–10 vocabulary inputs per practice; `term` is at most 80 characters, `meaningZh` 200, and `sourceSentence` 1,000.
- The first path is IELTS only, with a maximum of three free ready practices per anonymous user.
- Generation has a 120,000 ms total deadline and at most three total attempts.
- Correct answers and explanations must never be serialized before the first answer submission.
- Store all timestamps as UTC `timestamptz`; use UUID primary keys.
- Treat article text, source sentences, meanings, translations, answers, authorization headers, API keys, and database URLs as log-redacted data.
- Never drop, truncate, or recreate the configured database's `public` schema during tests.
- Use `apply_patch` for hand-written file changes and preserve unrelated user files.

---

## File Map

### Workspace and contracts

- Create `package.json`: root npm workspace and aggregate commands.
- Create `tsconfig.base.json`: strict shared TypeScript settings.
- Create `.gitignore`: root server/build/test exclusions.
- Remove `app/package-lock.json`: replace the nested lock with the root workspace lock.
- Modify `app/package.json`: add the contracts workspace and client test/typecheck scripts.
- Create `packages/contracts/package.json` and `packages/contracts/tsconfig.json`: pure TypeScript workspace package.
- Create `packages/contracts/src/index.ts`: all public DTO schemas and inferred types.
- Create `packages/contracts/src/index.test.ts`: boundary and secret-leak contract tests.

### Server foundation and persistence

- Create `server/package.json`, `server/tsconfig.json`, `server/tsup.config.ts`, `server/vitest.config.ts`: server toolchain.
- Create `server/src/config/env.ts`: fail-fast environment parsing.
- Create `server/src/core/errors.ts`: stable application errors.
- Create `server/src/app.ts`: Fastify composition root.
- Create `server/src/index.ts`: API/worker process lifecycle.
- Create `server/src/db/schema.ts`: complete Drizzle data model.
- Create `server/src/db/client.ts`: pool creation and shutdown.
- Create `server/src/db/migrate.ts` and `server/drizzle.config.ts`: explicit migrations.
- Create `server/test/database.ts`: isolated `app_test_*` schema harness.

### Server feature modules

- Create `server/src/modules/auth/*`: anonymous registration, token hashing, and authentication.
- Create `server/src/modules/vocabulary/*`: normalization, exact-sense reuse, and listing.
- Create `server/src/modules/quota/*`: three-credit ledger.
- Create `server/src/modules/idempotency/*`: request-hash and resource replay.
- Create `server/src/modules/practice/*`: creation, retrieval, article serialization, answers, and progress.
- Create `server/src/modules/jobs/*`: claim leases, retry policy, runner, and graceful stop.
- Create `server/src/modules/translation/*`: cached translation resources and jobs.
- Create `server/src/infrastructure/ai/*`: EvoLink adapter, prompts, JSON extraction, validators, and fake provider.
- Move the responsibility of `app/server/evolink.mjs` and `app/scripts/test-evolink.mjs` into the server package, then remove those legacy files.

### Expo client

- Create `app/src/api/*`: installation credential, HTTP client, practice API, and storage keys.
- Create `app/src/features/practice/*`: reusable form, status, article, quiz, and feedback components.
- Create `app/src/app/practice/new.tsx`.
- Create `app/src/app/practice/[id]/generating.tsx`.
- Create `app/src/app/practice/[id]/read.tsx`.
- Create `app/src/app/practice/[id]/quiz.tsx`.
- Create `app/src/app/practice/[id]/result.tsx`.
- Modify `app/src/app/(tabs)/index.tsx`: real create/resume entry point.
- Modify `app/src/app/(tabs)/words.tsx`: replace mock vocabulary with API data.

### Documentation and verification

- Modify `app/.env.example`: document server and public client variables without values.
- Create `README.md`: workspace bootstrap and common commands.
- Create `server/README.md`: API lifecycle, migrations, test isolation, and status codes.
- Create `server/scripts/live-smoke.ts`: opt-in real Neon/EvoLink smoke flow.
- Create `server/scripts/check-client-secrets.ts`: scan an exported client without printing secret values.

---

### Task 1: Establish the workspace and shared API contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Delete: `app/package-lock.json`
- Modify: `app/package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/index.test.ts`

**Interfaces:**
- Produces: `VocabularyInputSchema`, `CreatePracticeRequestSchema`, `PracticeStatusSchema`, `PublicErrorSchema`, `PracticeDtoSchema`, `TranslationDtoSchema`, `AnswerResultSchema`, `VocabularyPageSchema`, and their inferred TypeScript types.
- Consumes: no earlier task.

- [ ] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  CreatePracticeRequestSchema,
  PublicQuestionSchema,
  PublicErrorSchema,
} from './index';

describe('shared contracts', () => {
  it('accepts one to ten vocabulary inputs', () => {
    expect(CreatePracticeRequestSchema.safeParse({
      items: [{ term: 'resilient', meaningZh: '有韧性的' }],
    }).success).toBe(true);
    expect(CreatePracticeRequestSchema.safeParse({ items: [] }).success).toBe(false);
    expect(CreatePracticeRequestSchema.safeParse({
      items: Array.from({ length: 11 }, (_, index) => ({
        term: `term-${index}`,
        meaningZh: '义项',
      })),
    }).success).toBe(false);
  });

  it('does not permit a correct answer in an unanswered question', () => {
    const result = PublicQuestionSchema.safeParse({
      id: crypto.randomUUID(),
      targetId: crypto.randomUUID(),
      term: 'resilient',
      prompt: '在本文语境中是什么意思？',
      options: Array.from({ length: 4 }, (_, index) => ({
        id: crypto.randomUUID(), label: `选项${index}`,
      })),
      submittedAnswer: null,
      correctOptionId: crypto.randomUUID(),
    });
    expect(result.success).toBe(false);
  });

  it('uses the stable public error envelope', () => {
    expect(PublicErrorSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: '输入有误',
        requestId: crypto.randomUUID(),
        retryable: false,
      },
    }).error.code).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npm test --workspace=@context-reader/contracts`

Expected: FAIL because `packages/contracts/src/index.ts` and the workspace package do not exist.

- [ ] **Step 3: Add root workspace configuration and contract package metadata**

```json
{
  "name": "context-reader",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=22.13.0" },
  "workspaces": ["app", "server", "packages/*"],
  "scripts": {
    "dev": "npm run dev --workspace=@context-reader/server",
    "dev:app": "npm run start --workspace=app",
    "build": "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "check": "npm run typecheck && npm run test && npm run lint"
  }
}
```

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
*.tsbuildinfo
.DS_Store
.trash-app-tmp/
```

```json
{
  "name": "@context-reader/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "4.5.4" },
  "devDependencies": {
    "typescript": "5.9.2",
    "vitest": "5.0.0"
  }
}
```

`packages/contracts/tsconfig.json` is:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Implement the complete initial DTO surface**

Create schemas with these exact discriminators and fields:

```ts
import { z } from 'zod';

export const UuidSchema = z.uuid();
export const PracticeStatusSchema = z.enum([
  'queued', 'generating', 'validating', 'ready',
  'in_progress', 'completed', 'failed',
]);
export const VocabularyStatusSchema = z.enum([
  'pending', 'reviewing', 'mastered', 'self_reported',
]);
export const VocabularyInputSchema = z.object({
  term: z.string().trim().min(1).max(80),
  meaningZh: z.string().trim().min(1).max(200),
  sourceSentence: z.string().trim().min(1).max(1000).optional(),
}).strict();
export const CreatePracticeRequestSchema = z.object({
  items: z.array(VocabularyInputSchema).min(1).max(10),
}).strict();
export const PublicErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: UuidSchema,
    retryable: z.boolean(),
  }).strict(),
}).strict();
export const PublicFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
}).strict();
export const ArticleSegmentSchema = z.object({
  text: z.string(),
  targetId: UuidSchema.nullable(),
}).strict();
export const ArticleParagraphSchema = z.object({
  id: UuidSchema,
  position: z.number().int().nonnegative(),
  segments: z.array(ArticleSegmentSchema).min(1),
}).strict();
const AnswerFeedbackFields = {
  wasAssisted: z.boolean(),
  correctOptionId: UuidSchema,
  meaningEn: z.string(),
  explanationZh: z.string(),
  optionExplanations: z.record(UuidSchema, z.string()),
};
export const AnswerResultSchema = z.discriminatedUnion('answerKind', [
  z.object({
    answerKind: z.literal('option'),
    selectedOptionId: UuidSchema,
    isCorrect: z.boolean(),
    ...AnswerFeedbackFields,
  }).strict(),
  z.object({
    answerKind: z.literal('dont_know'),
    selectedOptionId: z.null(),
    isCorrect: z.literal(false),
    ...AnswerFeedbackFields,
  }).strict(),
]);
export const PublicQuestionSchema = z.object({
  id: UuidSchema,
  targetId: UuidSchema,
  term: z.string(),
  prompt: z.string(),
  options: z.array(z.object({ id: UuidSchema, label: z.string() }).strict()).length(4),
  submittedAnswer: AnswerResultSchema.nullable(),
}).strict();
export const PracticeDtoSchema = z.object({
  id: UuidSchema,
  status: PracticeStatusSchema,
  modelName: z.string().nullable(),
  remainingFreePractices: z.number().int().nonnegative(),
  pollAfterMs: z.number().int().positive().optional(),
  failure: PublicFailureSchema.nullable(),
  article: z.object({
    title: z.string(),
    wordCount: z.number().int().positive(),
    paragraphs: z.array(ArticleParagraphSchema).min(1),
  }).strict().nullable(),
  questions: z.array(PublicQuestionSchema),
}).strict();
export const TranslationDtoSchema = z.object({
  id: UuidSchema,
  status: z.enum(['queued', 'generating', 'ready', 'failed']),
  scope: z.enum(['paragraph', 'full']),
  paragraphId: UuidSchema.nullable(),
  translatedTextZh: z.string().nullable(),
  pollAfterMs: z.number().int().positive().optional(),
  failure: PublicFailureSchema.nullable(),
}).strict();
export const VocabularyItemDtoSchema = z.object({
  id: UuidSchema,
  term: z.string(),
  meaningZh: z.string(),
  sourceSentence: z.string().nullable(),
  status: VocabularyStatusSchema,
  practiceCount: z.number().int().nonnegative(),
  firstTryCorrectCount: z.number().int().nonnegative(),
  assistedCount: z.number().int().nonnegative(),
  lastPracticedAt: z.iso.datetime().nullable(),
}).strict();
export const VocabularyPageSchema = z.object({
  items: z.array(VocabularyItemDtoSchema),
  nextCursor: z.string().nullable(),
}).strict();
export type PracticeStatus = z.infer<typeof PracticeStatusSchema>;
export type VocabularyStatus = z.infer<typeof VocabularyStatusSchema>;
export type VocabularyInput = z.infer<typeof VocabularyInputSchema>;
export type CreatePracticeRequest = z.infer<typeof CreatePracticeRequestSchema>;
export type PublicError = z.infer<typeof PublicErrorSchema>;
export type PracticeDto = z.infer<typeof PracticeDtoSchema>;
export type TranslationDto = z.infer<typeof TranslationDtoSchema>;
export type AnswerResult = z.infer<typeof AnswerResultSchema>;
export type VocabularyPage = z.infer<typeof VocabularyPageSchema>;
export type VocabularyItemDto = z.infer<typeof VocabularyItemDtoSchema>;
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;
export type ArticleSegment = z.infer<typeof ArticleSegmentSchema>;
export type ArticleParagraph = z.infer<typeof ArticleParagraphSchema>;
```

Every later task must keep `.strict()` on public object schemas, including nested objects, so unexpected server fields cannot silently pass client validation. For `TranslationDtoSchema`, return `failure: null` unless status is `failed`; for `PracticeDtoSchema`, use the same rule.

Modify `app/package.json` to add `"@context-reader/contracts": "*"` and `"typecheck": "tsc --noEmit"`. Client test dependencies and its `test` script are added in Task 12. Remove its nested lock, then run `npm install` at the repository root to create the sole `package-lock.json`.

- [ ] **Step 5: Run contract tests and workspace install checks**

Run: `npm test --workspace=@context-reader/contracts && npm run typecheck --workspace=@context-reader/contracts && npm why react-native`

Expected: contract tests PASS, TypeScript PASS, and exactly one React Native version (`0.81.5`) is resolved.

- [ ] **Step 6: Commit the workspace foundation**

```bash
git add .gitignore package.json package-lock.json tsconfig.base.json PRD.md app packages/contracts
git commit -m "build: establish app and server workspace"
```

Expected: the existing PRD, Expo source, assets, and non-secret project files become the repository baseline; `app/.env`, `app/.expo`, `node_modules`, and `.trash-app-tmp` remain untracked or ignored.

### Task 2: Build the Fastify shell, configuration, and public errors

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/tsup.config.ts`
- Create: `server/vitest.config.ts`
- Create: `server/eslint.config.js`
- Create: `server/src/config/env.ts`
- Create: `server/src/core/errors.ts`
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Test: `server/src/config/env.test.ts`
- Test: `server/src/app.test.ts`

**Interfaces:**
- Produces: `loadConfig(source): ServerConfig`, `AppError`, `buildApp(options): FastifyInstance`.
- Consumes: `PublicErrorSchema` from Task 1.

- [ ] **Step 1: Write failing configuration and health tests**

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

describe('loadConfig', () => {
  it('rejects missing secrets without printing values', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL, EVOLINK_API_KEY/);
  });

  it('parses defaults and comma-separated CORS origins', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://example.invalid/db',
      EVOLINK_API_KEY: 'secret',
      CORS_ORIGINS: 'http://localhost:8081,http://localhost:19006',
    });
    expect(config.freePracticeLimit).toBe(3);
    expect(config.generationDeadlineMs).toBe(120000);
    expect(config.corsOrigins).toEqual([
      'http://localhost:8081', 'http://localhost:19006',
    ]);
  });
});
```

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('health routes', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('returns a request id from liveness', async () => {
    const app = buildApp({ logger: false, readiness: async () => true });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the focused tests and verify missing-module failures**

Run: `npm test --workspace=@context-reader/server -- src/config/env.test.ts src/app.test.ts`

Expected: FAIL because the server package and modules do not exist.

- [ ] **Step 3: Add the server package with pinned dependencies**

```json
{
  "name": "@context-reader/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --env-file=../app/.env --watch --import tsx src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node --env-file=../app/.env --import tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@context-reader/contracts": "*",
    "@fastify/cors": "11.3.0",
    "@fastify/rate-limit": "11.2.0",
    "drizzle-orm": "0.45.2",
    "fastify": "5.12.3",
    "pg": "8.23.0",
    "pino": "10.3.1",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@eslint/js": "9.39.5",
    "@types/node": "22.20.1",
    "@types/pg": "8.23.1",
    "drizzle-kit": "0.31.10",
    "tsx": "4.23.13",
    "tsup": "8.5.1",
    "typescript": "5.9.2",
    "typescript-eslint": "8.69.0",
    "vite": "8.2.2",
    "vitest": "5.0.0",
    "eslint": "9.39.5"
  }
}
```

Add the tool configuration exactly as follows:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node", "vitest/globals"],
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts", "*.config.ts"]
}
```

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: ['@context-reader/contracts'],
});
```

```ts
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, '../app', ''));
  return {
    test: {
      include: ['src/**/*.test.ts'],
      testTimeout: 30000,
      hookTimeout: 30000,
      pool: 'forks',
      fileParallelism: false,
    },
  };
});
```

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'drizzle/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true } },
  },
);
```

- [ ] **Step 4: Implement fail-fast configuration and public error mapping**

```ts
import { z } from 'zod';

const RawEnvSchema = z.object({
  DATABASE_URL: z.url(),
  EVOLINK_API_KEY: z.string().min(1),
  EVOLINK_BASE_URL: z.url().default('https://direct.evolink.ai/v1'),
  EVOLINK_TEXT_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  EVOLINK_MODERATION_MODEL: z.string().min(1).default('evolink-moderation-1.0'),
  EVOLINK_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  FREE_PRACTICE_LIMIT: z.coerce.number().int().positive().default(3),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  JOB_LEASE_MS: z.coerce.number().int().positive().default(30000),
  GENERATION_DEADLINE_MS: z.coerce.number().int().positive().default(120000),
});

export function loadConfig(source: Record<string, string | undefined>) {
  const result = RawEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid environment variables: ${names.join(', ')}`);
  }
  return {
    ...result.data,
    corsOrigins: result.data.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean),
    freePracticeLimit: result.data.FREE_PRACTICE_LIMIT,
    generationDeadlineMs: result.data.GENERATION_DEADLINE_MS,
  };
}
export type ServerConfig = ReturnType<typeof loadConfig>;
```

```ts
export const errorCodes = [
  'VALIDATION_ERROR',
  'AGE_CONFIRMATION_REQUIRED',
  'UNAUTHORIZED',
  'TOKEN_REVOKED',
  'NOT_FOUND',
  'STATE_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'FREE_LIMIT_REACHED',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_INVALID_OUTPUT',
  'AI_CONTENT_REJECTED',
  'GENERATION_DEADLINE_EXCEEDED',
  'DATABASE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

- [ ] **Step 5: Implement the Fastify composition root and lifecycle entry**

`buildApp` must set `genReqId: () => crypto.randomUUID()`, return `x-request-id`, expose `/health/live` and `/health/ready`, and map every non-public exception to `INTERNAL_ERROR` without returning stack text. The logger redaction list is exactly:

```ts
export const redactPaths = [
  'req.headers.authorization',
  'request.headers.authorization',
  'DATABASE_URL',
  'EVOLINK_API_KEY',
  '*.article',
  '*.plainText',
  '*.sourceSentence',
  '*.meaningZh',
  '*.translatedTextZh',
];
```

The process entry loads config once, builds the app, listens on configured host/port, and closes on `SIGINT` or `SIGTERM`:

```ts
const shutdown = async () => {
  await app.close();
  process.exitCode = 0;
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
```

- [ ] **Step 6: Run server tests, typecheck, and build**

Run: `npm install && npm test --workspace=@context-reader/server -- src/config/env.test.ts src/app.test.ts && npm run typecheck --workspace=@context-reader/server && npm run lint --workspace=@context-reader/server && npm run build --workspace=@context-reader/server`

Expected: all tests PASS, TypeScript exits 0, and `server/dist/index.js` exists.

- [ ] **Step 7: Commit the server shell**

```bash
git add package-lock.json server
git commit -m "feat: add typed Fastify server shell"
```

### Task 3: Define and migrate the Neon data model safely

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`
- Modify: `server/src/index.ts`
- Create: `server/src/db/schema.ts`
- Create: `server/src/db/client.ts`
- Create: `server/src/db/migrate.ts`
- Create: `server/drizzle.config.ts`
- Create: `server/test/database.ts`
- Create: `server/src/db/schema.integration.test.ts`
- Generate: `server/drizzle/*`

**Interfaces:**
- Produces: `AppDatabase`, `AppTransaction`, `DatabaseHandle`, `createDatabase(databaseUrl): DatabaseHandle`, database injection through `buildApp`, all Drizzle table exports, and `withTestDatabase(run)`.
- Consumes: `ServerConfig` and `buildApp` from Task 2.

- [ ] **Step 1: Write a failing isolated-schema integration test**

```ts
import { expect, it } from 'vitest';
import { users, practiceSessions, jobs } from './schema';
import { withTestDatabase } from '../../test/database';

it('migrates an isolated schema and enforces practice ownership', async () => {
  await withTestDatabase(async ({ db }) => {
    const userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, kind: 'guest', ageConfirmedAt: new Date() });
    const practiceId = crypto.randomUUID();
    await db.insert(practiceSessions).values({
      id: practiceId, userId, examPath: 'ielts', status: 'queued',
    });
    await db.insert(jobs).values({
      id: crypto.randomUUID(), kind: 'practice_generation', resourceId: practiceId,
      status: 'queued', maxAttempts: 3, availableAt: new Date(),
      deadlineAt: new Date(Date.now() + 120000),
    });
    expect((await db.select().from(jobs))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and verify missing database modules**

Run: `npm test --workspace=@context-reader/server -- src/db/schema.integration.test.ts`

Expected: FAIL because the Schema and test harness do not exist.

- [ ] **Step 3: Implement the complete Drizzle schema from the approved design**

Use `pgEnum` for the exact enum values in the design. Create these tables and constraints in dependency order:

```ts
export const userKind = pgEnum('user_kind', ['guest', 'registered']);
export const vocabularyStatus = pgEnum('vocabulary_status', [
  'pending', 'reviewing', 'mastered', 'self_reported',
]);
export const practiceStatus = pgEnum('practice_status', [
  'queued', 'generating', 'validating', 'ready',
  'in_progress', 'completed', 'failed',
]);
export const translationStatus = pgEnum('translation_status', [
  'queued', 'generating', 'ready', 'failed',
]);
export const jobKind = pgEnum('job_kind', ['practice_generation', 'translation']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed']);
export const assistanceKind = pgEnum('assistance_kind', [
  'word_hint', 'paragraph_translation', 'full_translation',
]);
export const answerKind = pgEnum('answer_kind', ['option', 'dont_know']);
export const ledgerKind = pgEnum('ledger_kind', ['reserve', 'commit', 'release']);
```

Each table must contain every column and unique rule from design sections 8.1–8.5. Add these implementation-critical indexes:

```ts
uniqueIndex('installations_token_hash_unique').on(installations.tokenHash);
uniqueIndex('active_vocabulary_fingerprint_unique')
  .on(vocabularyItems.userId, vocabularyItems.fingerprint)
  .where(sql`${vocabularyItems.deletedAt} is null`);
uniqueIndex('practice_target_item_unique')
  .on(practiceTargets.practiceSessionId, practiceTargets.vocabularyItemId);
unique('translation_cache_unique')
  .on(translations.practiceSessionId, translations.scope, translations.paragraphId, translations.sourceHash)
  .nullsNotDistinct();
uniqueIndex('assistance_idempotency_unique')
  .on(assistanceEvents.userId, assistanceEvents.practiceSessionId, assistanceEvents.idempotencyKey);
uniqueIndex('answer_first_attempt_unique')
  .on(answerAttempts.userId, answerAttempts.practiceQuestionId);
uniqueIndex('idempotency_operation_key_unique')
  .on(idempotencyRecords.userId, idempotencyRecords.operation, idempotencyRecords.idempotencyKey);
uniqueIndex('usage_operation_unique').on(usageLedger.operationKey);
index('jobs_claimable_idx').on(jobs.status, jobs.availableAt, jobs.leaseExpiresAt);
```

Also add database checks so `translations.scope = 'full'` requires a null paragraph and `paragraph` requires a paragraph; each assistance kind has exactly its permitted target/paragraph shape; `answer_kind = 'dont_know'` requires a null selected option while `option` requires one; and ledger kind/amount pairs are exactly `reserve/-1`, `commit/0`, or `release/1`. Define `QuestionOption` and option-explanation JSON types in `schema.ts` so no downstream code casts untyped JSON.

- [ ] **Step 4: Implement pool construction, explicit migration, and isolated tests**

`createDatabase` configures `max: 10`, never logs the URL, and exposes one explicit owner for pool shutdown:

```ts
export type AppDatabase = NodePgDatabase<typeof schema>;
export type AppTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export interface DatabaseHandle {
  pool: Pool;
  db: AppDatabase;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseHandle {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle({ client: pool, schema });
  return { pool, db, close: () => pool.end() };
}
```

Change `buildApp` to require `config: ServerConfig` and `db: AppDatabase` in its options; route plugins receive those dependencies rather than importing a global database. Update the health test with explicit test config/database stubs. In `server/src/index.ts`, create one handle before `buildApp`, use its pool for readiness, and close resources exactly once in this order:

```ts
const database = createDatabase(config.DATABASE_URL);
const app = buildApp({
  config,
  db: database.db,
  readiness: async () => {
    await database.pool.query('select 1');
    return true;
  },
});
let shutdownPromise: Promise<void> | undefined;
const shutdown = () => shutdownPromise ??= (async () => {
  await app.close();
  await database.close();
  process.exitCode = 0;
})();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
```

If app construction or listening fails, close the database handle before rethrowing. `withTestDatabase` must:

```ts
export function withTestDatabase<T>(
  run: (context: { db: AppDatabase; pool: Pool; schemaName: string }) => Promise<T>,
): Promise<T>;
```

```ts
const schemaName = `app_test_${crypto.randomUUID().replaceAll('-', '')}`;
if (!/^app_test_[0-9a-f]{32}$/.test(schemaName)) {
  throw new Error('Unsafe test schema name');
}
await adminPool.query(`create schema "${schemaName}"`);
const pool = new Pool({
  connectionString: resolveSessionDatabaseUrl(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  ),
  max: 5,
  options: `-c search_path=${schemaName},public`,
});
```

Neon's transaction pooler rejects `search_path` as a startup option and does not preserve a later session-level `SET` reliably across concurrent transactions. For integration tests only, `resolveSessionDatabaseUrl` converts a recognized `*-pooler.*.neon.tech` hostname to the same branch's direct endpoint; production continues using the configured pooled URL. Set the validated random schema as a startup option on that direct connection and verify `current_schema()` before migration. Generated Drizzle SQL explicitly qualifies enum types and foreign keys with `"public".`, so `search_path` alone is not isolation. Copy `server/drizzle/` into a `mkdtemp` directory for each test, replace every `"public".` qualifier in copied `.sql` files with the already validated `"${schemaName}".`, assert the rewritten SQL contains no `"public".` qualifier, remove statement-breakpoint markers from the copy so remote test setup uses one round trip, and run Drizzle migration against that temporary folder with `{ migrationsFolder, migrationsSchema: schemaName }`; the committed migration remains unchanged. In `finally`, close the test pool, validate the same prefix again, execute only `drop schema "${schemaName}" cascade` through the admin pool, close the admin pool, and remove only the temporary migration directory so Vitest has no open handles. If neither database variable exists, fail with `Database integration tests require TEST_DATABASE_URL or DATABASE_URL`.

`server/drizzle.config.ts` loads the existing development env only when the process has not already supplied a URL:

```ts
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) loadEnvFile('../app/.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
});
```

- [ ] **Step 5: Generate the migration and run the database test**

Run: `npm run db:generate --workspace=@context-reader/server`

Expected: a new SQL migration under `server/drizzle/` containing all 14 business tables plus enum definitions.

Run: `npm test --workspace=@context-reader/server -- src/db/schema.integration.test.ts`

Expected: PASS and no table is created in `public` by the test harness.

- [ ] **Step 6: Apply the migration to the configured development database**

Run first: `node --env-file=app/.env -e "const u=new URL(process.env.DATABASE_URL); console.log({protocol:u.protocol,host:u.host,database:u.pathname.slice(1),hasPassword:Boolean(u.password)})"`

Expected: only connection metadata and `hasPassword: true`; no password is printed.

Run: `npm run db:migrate --workspace=@context-reader/server`

Expected: migration exits 0. Run it a second time; expected result is also exit 0 with no duplicate objects.

- [ ] **Step 7: Commit the data model**

```bash
git add server/drizzle.config.ts server/drizzle server/src/app.ts server/src/app.test.ts server/src/index.ts server/src/db server/test/database.ts
git commit -m "feat: add durable practice data model"
```

### Task 4: Add anonymous 14+ identity and bearer authentication

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/index.test.ts`
- Create: `server/src/modules/auth/token.ts`
- Create: `server/src/modules/auth/service.ts`
- Create: `server/src/modules/auth/routes.ts`
- Create: `server/src/modules/auth/plugin.ts`
- Create: `server/src/types/fastify.d.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/modules/auth/auth.integration.test.ts`

**Interfaces:**
- Produces: `hashInstallationToken(token): string`, `registerAnonymous(db, token, ageConfirmed14Plus): Promise<AuthUser>`, `requireAuth`, and `request.authUser: { userId: string; installationId: string }`.
- Consumes: `AppDatabase`, `users`, and `installations` from Task 3.

- [ ] **Step 1: Write failing identity tests**

```ts
it('creates one user for repeated registration with the same token', async () => {
  const token = 'ab'.repeat(32);
  const first = await registerAnonymous(db, token, true);
  const second = await registerAnonymous(db, token, true);
  expect(second.userId).toBe(first.userId);
  expect(await db.select().from(users)).toHaveLength(1);
});

it('requires an explicit 14+ confirmation for a new token', async () => {
  await expect(registerAnonymous(db, 'cd'.repeat(32), false))
    .rejects.toMatchObject({ code: 'AGE_CONFIRMATION_REQUIRED', statusCode: 403 });
});

it('stores only a token hash', async () => {
  const token = 'ef'.repeat(32);
  await registerAnonymous(db, token, true);
  const [row] = await db.select().from(installations);
  expect(row?.tokenHash).toBe(hashInstallationToken(token));
  expect(JSON.stringify(row)).not.toContain(token);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test --workspace=@context-reader/server -- modules/auth/auth.integration.test.ts`

Expected: FAIL because `registerAnonymous` is undefined.

- [ ] **Step 3: Implement strict token parsing and registration**

```ts
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export interface AuthUser {
  userId: string;
  installationId: string;
  created: boolean;
}

export function parseBearerToken(header: string | undefined): string {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(header ?? '');
  if (!match) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  return match[1];
}

export function hashInstallationToken(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
```

Within the registration transaction, acquire `select pg_advisory_xact_lock(hashtext(${tokenHash}))`, read the installation by hash, return its owner if active, or create one `users` row and one `installations` row. Reject revoked installations as `TOKEN_REVOKED`.

- [ ] **Step 4: Register the auth route and request decorator**

Add and export these strict shared contracts:

```ts
export const AnonymousAuthRequestSchema = z.object({
  ageConfirmed14Plus: z.literal(true),
}).strict();
export const AnonymousAuthResponseSchema = z.object({
  userId: UuidSchema,
  kind: z.literal('guest'),
  remainingFreePractices: z.number().int().nonnegative(),
}).strict();
export type AnonymousAuthRequest = z.infer<typeof AnonymousAuthRequestSchema>;
export type AnonymousAuthResponse = z.infer<typeof AnonymousAuthResponseSchema>;
```

`POST /v1/auth/anonymous` reads the bearer token, performs registration, and returns `201` for a new identity or `200` for an existing identity. In this task it returns the configured free limit because no usage can exist yet; Task 5 replaces that field calculation with `getRemainingQuota`. `requireAuth` looks up the active installation and decorates the request; every later business route uses it.

- [ ] **Step 5: Run auth and regression tests**

Run: `npm test --workspace=@context-reader/server -- modules/auth src/app.test.ts`

Expected: all auth tests PASS; malformed, missing, and revoked credentials return the stable error envelope.

- [ ] **Step 6: Commit anonymous authentication**

```bash
git add packages/contracts server/src/modules/auth server/src/types server/src/app.ts
git commit -m "feat: add anonymous installation identity"
```

### Task 5: Create practices transactionally with exact vocabulary reuse, quota, and idempotency

**Files:**
- Create: `server/src/modules/vocabulary/normalize.ts`
- Create: `server/src/modules/vocabulary/repository.ts`
- Create: `server/src/modules/quota/service.ts`
- Create: `server/src/modules/idempotency/service.ts`
- Create: `server/src/modules/practice/create-service.ts`
- Create: `server/src/modules/practice/routes.ts`
- Modify: `server/src/modules/auth/routes.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/modules/vocabulary/normalize.test.ts`
- Test: `server/src/modules/practice/create.integration.test.ts`

**Interfaces:**
- Produces: `normalizeTerm`, `normalizeMeaningZh`, `vocabularyFingerprint`, `rejectDuplicateInputs`, `upsertExactVocabularyItems`, `reserveQuota`, `commitQuota`, `releaseQuota`, `getRemainingQuota`, `beginIdempotentOperation`, `finishIdempotentOperation`, `createPractice(input)`, and `POST /v1/practices`.
- Consumes: authenticated `request.authUser`, tables from Task 3, and `CreatePracticeRequestSchema` from Task 1.

- [ ] **Step 1: Write failing normalization and transactional tests**

```ts
expect(normalizeTerm('  ReSILIENT\u3000')).toBe('resilient');
expect(normalizeMeaningZh('  有  韧性 的。 ')).toBe('有 韧性 的。');
expect(vocabularyFingerprint('Charge', '收费')).toBe(
  vocabularyFingerprint(' charge ', ' 收费 '),
);
expect(vocabularyFingerprint('charge', '收费')).not.toBe(
  vocabularyFingerprint('charge', '指控'),
);
```

The integration test must create a user, call `createPractice` twice concurrently with the same idempotency key, assert the same practice ID, one vocabulary row, one practice, one queued job, and ledger sum `-1`. Reuse the key with changed input and expect `IDEMPOTENCY_KEY_REUSED`. For a second user, race four distinct create keys at a free limit of three; assert exactly three succeed, one returns `FREE_LIMIT_REACHED`, and exactly three reserve rows/practices/jobs exist.

- [ ] **Step 2: Run the focused tests and verify failures**

Run: `npm test --workspace=@context-reader/server -- modules/vocabulary/normalize.test.ts modules/practice/create.integration.test.ts`

Expected: FAIL because practice creation services are missing.

- [ ] **Step 3: Implement deterministic normalization and hashing**

```ts
const collapseWhitespace = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');

export const normalizeTerm = (value: string) => collapseWhitespace(value).toLocaleLowerCase('en-US');
export const normalizeMeaningZh = (value: string) => collapseWhitespace(value);
export const vocabularyFingerprint = (term: string, meaningZh: string) =>
  createHash('sha256')
    .update(`${normalizeTerm(term)}\u0000${normalizeMeaningZh(meaningZh)}`)
    .digest('hex');
```

- [ ] **Step 4: Implement the quota and idempotency primitives**

`reserveQuota` takes a transaction, locks the user's row, sums `usage_ledger.amount`, and inserts one `reserve/-1` row only when remaining quota is positive. `commitQuota` inserts `commit/0` only when the reserve exists and no release exists; `releaseQuota` inserts `release/+1` only when the reserve exists and no commit exists. Both lock the practice row first, so commit and release cannot both win. Every operation key is `${practiceId}:reserve`, `${practiceId}:commit`, or `${practiceId}:release` and uses conflict-ignore semantics for safe replay.

`beginIdempotentOperation` hashes the Zod-parsed body with SHA-256, then acquires a transaction-scoped advisory lock derived from `userId + operation + idempotencyKey` before reading or inserting. A matching record returns its resource ID; a mismatched hash throws `IDEMPOTENCY_KEY_REUSED`.

Use these exact public signatures; `finishIdempotentOperation` derives `resourceType` from the stable operation name and sets `expiresAt` 30 days ahead. This slice continues honoring records after that timestamp; expiry exists for a later audited cleanup job, so a key can never unexpectedly regain a different meaning during this implementation.

```ts
export type IdempotencyOperation =
  | 'create_practice'
  | 'request_translation'
  | 'record_assistance'
  | 'submit_answer';

export function beginIdempotentOperation(
  tx: AppTransaction,
  userId: string,
  operation: IdempotencyOperation,
  idempotencyKey: string,
  requestMaterial: unknown,
): Promise<string | null>;

export function finishIdempotentOperation(
  tx: AppTransaction,
  userId: string,
  operation: IdempotencyOperation,
  idempotencyKey: string,
  resourceId: string,
): Promise<void>;
```

- [ ] **Step 5: Implement one-transaction practice creation**

```ts
export interface CreatedPractice {
  practiceId: string;
  status: 'queued' | 'generating' | 'validating' | 'ready' | 'in_progress' | 'completed' | 'failed';
  remainingFreePractices: number;
  pollAfterMs?: 1500;
}

export async function createPractice(
  db: AppDatabase,
  input: {
    userId: string;
    idempotencyKey: string;
    items: VocabularyInput[];
    freeLimit: number;
    generationDeadlineMs: number;
  },
): Promise<CreatedPractice> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(tx, input.userId, 'create_practice', input.idempotencyKey, input.items);
    if (replay) {
      const [practice] = await tx.select({ status: practiceSessions.status })
        .from(practiceSessions)
        .where(and(eq(practiceSessions.id, replay), eq(practiceSessions.userId, input.userId)))
        .limit(1);
      if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
      const remainingFreePractices = await getRemainingQuota(tx, input.userId, input.freeLimit);
      return {
        practiceId: replay,
        status: practice.status,
        remainingFreePractices,
        ...(practice.status === 'queued' || practice.status === 'generating' || practice.status === 'validating'
          ? { pollAfterMs: 1500 as const }
          : {}),
      };
    }
    rejectDuplicateInputs(input.items);
    const practiceId = crypto.randomUUID();
    await tx.insert(practiceSessions).values({
      id: practiceId, userId: input.userId, examPath: 'ielts', status: 'queued',
    });
    const remaining = await reserveQuota(tx, input.userId, practiceId, input.freeLimit);
    const itemIds = await upsertExactVocabularyItems(tx, input.userId, input.items);
    await tx.insert(practiceTargets).values(itemIds.map((vocabularyItemId, position) => ({
      id: crypto.randomUUID(), practiceSessionId: practiceId, vocabularyItemId, position,
    })));
    await tx.insert(jobs).values({
      id: crypto.randomUUID(), kind: 'practice_generation', resourceId: practiceId,
      status: 'queued', attemptCount: 0, maxAttempts: 3,
      availableAt: new Date(),
      deadlineAt: new Date(Date.now() + input.generationDeadlineMs),
    });
    await finishIdempotentOperation(tx, input.userId, 'create_practice', input.idempotencyKey, practiceId);
    return { practiceId, status: 'queued', remainingFreePractices: remaining, pollAfterMs: 1500 };
  });
}
```

Add and export the accepted-response contract:

```ts
export const CreatePracticeAcceptedSchema = z.object({
  practiceId: UuidSchema,
  status: PracticeStatusSchema,
  remainingFreePractices: z.number().int().nonnegative(),
  pollAfterMs: z.number().int().positive().optional(),
}).strict();
export type CreatePracticeAccepted = z.infer<typeof CreatePracticeAcceptedSchema>;
```

- [ ] **Step 6: Register and verify `POST /v1/practices`**

Require `Idempotency-Key` matching `^[A-Za-z0-9_-]{16,128}$`, authenticate first, parse with `CreatePracticeRequestSchema`, pass `config.generationDeadlineMs`, return `202`, and never log the body. Update the anonymous-auth response to calculate `remainingFreePractices` with `getRemainingQuota` instead of assuming no ledger rows.

Run: `npm test --workspace=@context-reader/server -- modules/vocabulary modules/practice/create.integration.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 7: Commit transactional creation**

```bash
git add server/src/modules packages/contracts/src server/src/app.ts
git commit -m "feat: create idempotent practice jobs"
```

### Task 6: Implement the PostgreSQL lease queue and worker lifecycle

**Files:**
- Create: `server/src/modules/jobs/repository.ts`
- Create: `server/src/modules/jobs/retry.ts`
- Create: `server/src/modules/jobs/runner.ts`
- Create: `server/src/modules/jobs/types.ts`
- Test: `server/src/modules/jobs/repository.integration.test.ts`
- Test: `server/src/modules/jobs/retry.test.ts`

**Interfaces:**
- Produces: `claimNextJob`, `claimExpiredJob`, `renewLease`, `markSucceeded`, `rescheduleOrFail`, `JobHandler`, `JobFailureHandler`, `JobRegistration`, and `startJobRunner`.
- Consumes: `jobs` table and database lifecycle.

- [ ] **Step 1: Write failing concurrency and retry tests**

Create one queued job, invoke `claimNextJob` concurrently with two worker IDs, and assert exactly one non-null result. Advance a fake clock past `leaseExpiresAt` and assert a third worker can reclaim it. Create a job whose `deadlineAt` is in the past and assert `claimExpiredJob` returns it once so its resource failure hook can release quota. Verify retry delays of 1,000 ms then 2,000 ms, capped by the resource deadline.

```ts
expect(retryDelayMs(1, () => 0)).toBe(1000);
expect(retryDelayMs(2, () => 0)).toBe(2000);
expect(shouldRetry({ attemptCount: 3, maxAttempts: 3, deadlineAt: future })).toBe(false);
```

- [ ] **Step 2: Run tests and verify queue modules are missing**

Run: `npm test --workspace=@context-reader/server -- modules/jobs`

Expected: FAIL because queue functions do not exist.

- [ ] **Step 3: Implement atomic claiming with a lease**

Use one parameterized query with this shape and map the returned row through a Zod schema:

```sql
with candidate as (
  select id
  from jobs
  where available_at <= now()
    and deadline_at > now()
    and (
      status = 'queued'
      or (status = 'running' and lease_expires_at < now())
    )
  order by available_at asc, created_at asc
  for update skip locked
  limit 1
)
update jobs
set status = 'running',
    attempt_count = attempt_count + 1,
    locked_at = now(),
    lease_expires_at = now() + ($1 * interval '1 millisecond'),
    locked_by = $2
where id in (select id from candidate)
returning *;
```

Every completion/update includes `where id = jobId and locked_by = workerId and status = 'running'`; zero affected rows means lease loss and must not write resource results. `claimExpiredJob` separately locks one queued or lease-expired running job with `deadline_at <= now()`, assigns a fresh short lease, and returns it with `expired: true`. The runner invokes the idempotent kind-specific permanent-failure hook before marking the job failed; a crash between those actions safely retries the hook after lease expiry.

- [ ] **Step 4: Implement an abortable worker loop**

```ts
export type JobKind = 'practice_generation' | 'translation';
export interface ClaimedJob {
  id: string;
  kind: JobKind;
  resourceId: string;
  attemptCount: number;
  maxAttempts: number;
  deadlineAt: Date;
  lockedBy: string;
  expired: boolean;
}
export type JobHandler = (job: ClaimedJob, context: { signal: AbortSignal }) => Promise<void>;
export type JobFailureHandler = (
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
) => Promise<void>;
export interface JobRegistration {
  handle: JobHandler;
  onPermanentFailure: JobFailureHandler;
}
export interface RunnerOptions {
  db: AppDatabase;
  workerId: string;
  leaseMs: number;
  pollIntervalMs: number;
  enabledKinds: readonly JobKind[];
  registrations: Partial<Record<JobKind, JobRegistration>>;
}

export function startJobRunner(options: RunnerOptions) {
  const controller = new AbortController();
  const done = runLoop(options, controller.signal);
  return {
    stop: async () => {
      controller.abort();
      await done;
    },
  };
}
```

For every claimed job, start a lease heartbeat at `leaseMs / 3`; abort the handler immediately when renewal affects zero rows, and clear the heartbeat in `finally`. Each loop finalizes expired jobs before claiming runnable work. Unknown job kinds fail permanently. Retryable `AppError`s are rescheduled with jitter while attempts and deadline remain; permanent errors are finalized through the resource-specific failure hook. Do not start the runner from `server/src/index.ts` until Task 8 supplies the generation handler; this prevents a partially built server from failing queued practices as unknown work.

- [ ] **Step 5: Run concurrency tests three times**

Run: `for i in 1 2 3; do npm test --workspace=@context-reader/server -- modules/jobs || exit 1; done`

Expected: all three runs PASS with only one worker claim each time.

- [ ] **Step 6: Commit the worker queue**

```bash
git add server/src/modules/jobs
git commit -m "feat: add recoverable database job runner"
```

### Task 7: Replace the legacy EvoLink script with a typed AI provider

**Files:**
- Create: `server/src/infrastructure/ai/types.ts`
- Create: `server/src/infrastructure/ai/generated-schemas.ts`
- Create: `server/src/infrastructure/ai/json.ts`
- Create: `server/src/infrastructure/ai/evolink-client.ts`
- Create: `server/src/infrastructure/ai/evolink-provider.ts`
- Create: `server/src/infrastructure/ai/prompts.ts`
- Create: `server/src/infrastructure/ai/fake-provider.ts`
- Test: `server/src/infrastructure/ai/json.test.ts`
- Test: `server/src/infrastructure/ai/evolink-client.test.ts`
- Delete: `app/server/evolink.mjs`
- Delete: `app/scripts/test-evolink.mjs`
- Modify: `app/package.json`

**Interfaces:**
- Produces: `AiProvider.generatePractice`, `AiProvider.verifyPractice`, `AiProvider.translate`, `AiProvider.moderate`, and deterministic `FakeAiProvider`.
- Consumes: validated EvoLink config from Task 2.

- [ ] **Step 1: Write failing JSON extraction and HTTP-redaction tests**

```ts
expect(extractJsonObject('```json\n{"title":"A"}\n```')).toEqual({ title: 'A' });
expect(() => extractJsonObject('not json')).toThrow(/AI_INVALID_OUTPUT/);
```

Stub `global.fetch` to return success, 429, invalid JSON, and a delayed abort. Assert 429 maps to retryable `AI_UNAVAILABLE`, invalid bodies map to `AI_INVALID_OUTPUT`, timeouts map to retryable `AI_UNAVAILABLE`, and no thrown message contains the API key.

- [ ] **Step 2: Run tests and verify missing provider modules**

Run: `npm test --workspace=@context-reader/server -- infrastructure/ai`

Expected: FAIL because the AI modules do not exist.

- [ ] **Step 3: Define generated output and provider types**

```ts
export const GeneratedPracticeSchema = z.object({
  title: z.string().min(1).max(160),
  paragraphs: z.array(z.object({
    key: z.string().min(1),
    text: z.string().min(1),
  }).strict()).min(3),
  usages: z.array(z.object({
    targetAlias: z.string().regex(/^t[1-9][0-9]?$/),
    paragraphKey: z.string().min(1),
    surfaceForm: z.string().min(1),
  }).strict()),
  questions: z.array(z.object({
    targetAlias: z.string(),
    prompt: z.string().min(1),
    optionsZh: z.array(z.string().min(1)).length(4),
    meaningEn: z.string().min(1),
    explanationZh: z.string().min(1),
    optionExplanationsZh: z.array(z.string().min(1)).length(4),
  }).strict()),
}).strict();
export const VerificationSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()),
}).strict();

export type GeneratedPractice = z.infer<typeof GeneratedPracticeSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
export interface GeneratePracticeInput {
  examPath: 'ielts';
  targets: Array<{
    alias: string;
    term: string;
    meaningZh: string;
    sourceSentence?: string;
  }>;
}
export interface VerifyPracticeInput extends GeneratePracticeInput {
  generated: GeneratedPractice;
}

export interface AiProvider {
  generatePractice(input: GeneratePracticeInput, signal: AbortSignal): Promise<GeneratedPractice>;
  verifyPractice(input: VerifyPracticeInput, signal: AbortSignal): Promise<Verification>;
  translate(text: string, signal: AbortSignal): Promise<string>;
  moderate(text: string, signal: AbortSignal): Promise<{ riskLevel: 'low' | 'medium' | 'high'; flagged: boolean }>;
}
```

`AiProvider` takes one-use aliases rather than database IDs. The generated prompt must require 700–1,000 English words, a safe non-current-events topic, each target exactly once in its declared paragraph, four unique Chinese options, and the exact supplied `meaningZh` as one option.

- [ ] **Step 4: Implement the EvoLink client by porting proven behavior**

Keep the existing base URL, model defaults, timeout, OpenAI-compatible `/chat/completions`, and `/moderations` calls. Accept an injected `fetch` for tests. Combine the worker signal and timeout with `AbortSignal.any`, so lease loss cancels an in-flight supplier request. The final Gemini message may not use the assistant role. Extract text from either string or content-part arrays. All response parsing goes through Zod before returning.

- [ ] **Step 5: Implement real and fake providers**

`EvolinkAiProvider` uses the generation prompt, parses `GeneratedPracticeSchema`, sends the complete generated artifact to a separate verification prompt, translates only supplied source text, and calls moderation on final user-visible content. `FakeAiProvider` deterministically produces 700–1,000 English words across at least three paragraphs, places every supplied target once, returns four unique options with the supplied meaning included, approves verification, returns `{ riskLevel: 'low', flagged: false }`, and prefixes translations with `译文：`.

- [ ] **Step 6: Run AI tests and remove legacy scripts**

Run: `npm test --workspace=@context-reader/server -- infrastructure/ai && npm run typecheck --workspace=@context-reader/server`

Expected: PASS. `rg -n "EVOLINK_API_KEY" app/src app/assets` must return no matches.

- [ ] **Step 7: Commit the provider boundary**

```bash
git add server/src/infrastructure/ai app/package.json app/server/evolink.mjs app/scripts/test-evolink.mjs
git commit -m "feat: add typed EvoLink provider"
```

### Task 8: Generate, validate, persist, and read safe practices

**Files:**
- Create: `server/src/modules/practice/state.ts`
- Create: `server/src/modules/practice/generation-validator.ts`
- Create: `server/src/modules/practice/generation-handler.ts`
- Create: `server/src/modules/practice/serializer.ts`
- Create: `server/src/modules/practice/get-service.ts`
- Modify: `server/src/modules/practice/routes.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/modules/practice/generation-validator.test.ts`
- Test: `server/src/modules/practice/state.test.ts`
- Test: `server/src/modules/practice/generation.integration.test.ts`
- Test: `server/src/modules/practice/get.integration.test.ts`

**Interfaces:**
- Produces: `assertPracticeTransition`, `validateGeneratedPractice`, `handlePracticeGeneration`, `segmentParagraph`, `getPracticeForUser`, and `GET /v1/practices/:id`.
- Consumes: `AiProvider`, job runner, quota service, practice tables, and `PracticeDtoSchema`.

- [ ] **Step 1: Write failing validation and secrecy tests**

Test missing aliases, duplicate aliases, duplicate options, a supplied meaning absent from options, fewer than 700 or more than 1,000 English words, missing surface forms, repeated surface forms, overlapping ranges, verifier rejection, moderation risk other than `low`, and `flagged: true` even when risk is reported as low. Test that `GET /v1/practices/:id` for a ready unanswered practice contains option IDs/labels but its JSON text does not contain `correctOptionId`, `meaningEn`, `explanationZh`, or `optionExplanations`.

- [ ] **Step 2: Run focused tests and verify failures**

Run: `npm test --workspace=@context-reader/server -- modules/practice/generation modules/practice/get.integration.test.ts`

Expected: FAIL because generation handling is missing.

- [ ] **Step 3: Implement deterministic validation and segmentation**

Define and unit-test the only permitted transitions, including the bounded validation-to-regeneration retry edge:

```ts
const allowedTransitions: Record<PracticeStatus, readonly PracticeStatus[]> = {
  queued: ['generating', 'failed'],
  generating: ['validating', 'failed'],
  validating: ['generating', 'ready', 'failed'],
  ready: ['in_progress', 'completed'],
  in_progress: ['completed'],
  completed: [],
  failed: [],
};

export function assertPracticeTransition(from: PracticeStatus, to: PracticeStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new AppError('STATE_CONFLICT', '练习状态已变更', 409);
  }
}
```

```ts
interface TargetRange {
  id: string;
  startOffset: number;
  endOffset: number;
}

export function segmentParagraph(text: string, targets: TargetRange[]): ArticleSegment[] {
  const sorted = [...targets].sort((left, right) => left.startOffset - right.startOffset);
  const result: ArticleSegment[] = [];
  let cursor = 0;
  for (const target of sorted) {
    if (target.startOffset < cursor || target.endOffset <= target.startOffset) {
      throw new AppError('AI_INVALID_OUTPUT', '生成内容未通过结构检查', 502, true);
    }
    if (cursor < target.startOffset) result.push({ text: text.slice(cursor, target.startOffset), targetId: null });
    result.push({ text: text.slice(target.startOffset, target.endOffset), targetId: target.id });
    cursor = target.endOffset;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), targetId: null });
  return result;
}
```

Find each declared `surfaceForm` case-insensitively and require exactly one match within the declared paragraph. Require aliases `t1` through `tN` exactly once and find the correct option by normalized equality with the stored Chinese meaning, never by a model-provided index.

- [ ] **Step 4: Implement the generation state machine and persistence transaction**

The handler first returns successfully without calling AI when the practice is already `ready`, `in_progress`, or `completed`; this makes recovery after a worker crash idempotent. Otherwise it must compare `deadlineAt` before each provider call, moderate the serialized target inputs, transition `queued/generating → generating → validating`, call generation, deterministic validation, semantic verification, and final visible-content moderation, then insert paragraphs, target offsets, questions, and stable option UUIDs in one transaction. Input moderation rejection is permanent `AI_CONTENT_REJECTED`; invalid generated structure, verifier rejection, or generated-content rejection is retryable so the runner can make at most three total generation attempts. In that same transaction verify the job lease owner, set `ready_at`, set status `ready`, and call `commitQuota`.

On final failure, the job runner invokes `failPracticeGeneration`, which sets status `failed`, stores only a public failure code/message, and calls `releaseQuota` in the same transaction. A lost lease prevents either path from writing.

Register `practice_generation: handlePracticeGeneration` and its `failPracticeGeneration` hook in `server/src/index.ts`. At this task boundary, `practice_generation` is the only enqueueable kind. Start the runner after Fastify is listening and the database readiness check has passed; stop the runner before closing Fastify and the pool. Validate the handler registry before listening, and reject startup if any currently enqueueable kind lacks both a handler and permanent-failure hook.

- [ ] **Step 5: Implement status-aware serialization**

Every state returns `modelName` (`null` until generation persists it). Queued states return `pollAfterMs: 1500`, `article: null`, and no questions. Failed states return the public failure object. Ready/in-progress/completed states return segmented paragraphs and public question fields. For each already-answered question, join its immutable answer and include the feedback object; unanswered questions serialize `submittedAnswer: null`.

- [ ] **Step 6: Run generation and no-leak tests**

Run: `npm test --workspace=@context-reader/server -- modules/practice`

Expected: PASS, including exact target placement, ready persistence, permanent-failure quota release, and answer secrecy.

- [ ] **Step 7: Commit generated practice delivery**

```bash
git add server/src/modules/practice server/src/index.ts
git commit -m "feat: generate and deliver validated practices"
```

### Task 9: Add cached asynchronous translations

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `server/src/modules/translation/service.ts`
- Create: `server/src/modules/translation/handler.ts`
- Create: `server/src/modules/translation/routes.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/modules/translation/translation.integration.test.ts`

**Interfaces:**
- Produces: `requestTranslation`, `handleTranslation`, `POST /v1/practices/:id/translations`, and `GET /v1/translations/:id`.
- Consumes: `AiProvider.translate`, job runner, idempotency, practice ownership, and `TranslationDtoSchema`.

- [ ] **Step 1: Write failing cache and ownership tests**

Test paragraph and full requests, a paragraph from another practice, a cached request returning the same translation ID, an idempotent retry creating one job, and a completed translation returning text only to its owner. Assert requesting a translation does not create an assistance event.

- [ ] **Step 2: Run translation tests and verify failure**

Run: `npm test --workspace=@context-reader/server -- modules/translation`

Expected: FAIL because translation routes and handler do not exist.

- [ ] **Step 3: Implement cache-keyed translation creation**

Add this strict shared request contract:

```ts
export const TranslationRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('paragraph'), paragraphId: UuidSchema }).strict(),
  z.object({ scope: z.literal('full') }).strict(),
]);
export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;
```

Start the transaction with `beginIdempotentOperation` using operation `request_translation` and request material `{ practiceId, ...parsedBody }`; a changed practice or scope under the same key returns `IDEMPOTENCY_KEY_REUSED`. Use `sourceHash = sha256(practiceId + '\0' + scope + '\0' + paragraphIdOrEmpty + '\0' + sourceText)`. Verify ownership/readiness, acquire an advisory lock derived from the cache identity, reuse a ready or active matching translation, otherwise create one translation and one translation job with `maxAttempts: 3` and a 120,000 ms deadline. Finish the idempotency record with the chosen translation ID even on a cache hit. Return `200` only when the row is already `ready`; return `202` for an active row, new work, or an explicit retry of a failed row. This lock plus `translation_cache_unique NULLS NOT DISTINCT` guarantees that concurrent requests with different idempotency keys still create one cache row and one active job.

- [ ] **Step 4: Implement the translation handler**

Load the immutable source text, set status `generating`, call `AiProvider.translate`, and reject output that is blank, lacks any Han-script character (`/\p{Script=Han}/u`), has moderation risk other than `low`, or is flagged. Then update the row to `ready` only while the job lease still belongs to this worker. Retryable errors leave the resource retryable while the runner reschedules the same job. The permanent-failure hook sets the row to `failed` under the same lease check. A later new idempotency key resets that same failed row to `queued`, clears `translated_text_zh`, and creates one new job; it does not create a second cache row. Failed translation DTOs expose only `{ code: 'AI_UNAVAILABLE', message: '翻译暂时无法完成', retryable: true }` and never provider details.

Update the registry in `server/src/index.ts` to contain both `practice_generation` and `translation`, each with a handler and permanent-failure hook. Restarting the process must validate this complete registry before either kind can be claimed.

- [ ] **Step 5: Run translation tests**

Run: `npm test --workspace=@context-reader/server -- modules/translation modules/jobs`

Expected: PASS, with one provider call for concurrent identical requests and no assistance side effect.

- [ ] **Step 6: Commit translations**

```bash
git add packages/contracts/src server/src/modules/translation server/src/app.ts server/src/index.ts
git commit -m "feat: add cached practice translations"
```

### Task 10: Record assistance, grade first answers, and update progress

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `server/src/modules/practice/assistance-service.ts`
- Create: `server/src/modules/practice/answer-service.ts`
- Modify: `server/src/modules/practice/routes.ts`
- Test: `server/src/modules/practice/answer.integration.test.ts`

**Interfaces:**
- Produces: `recordAssistance`, `submitFirstAnswer`, `POST /v1/practices/:id/assistance`, and `POST /v1/practices/:id/answers`.
- Consumes: authenticated ownership, immutable questions, idempotency, assistance events, answers, and learning progress.

- [ ] **Step 1: Write failing evidence tests**

Cover these exact cases:

- word hint marks only its target assisted;
- paragraph translation marks every target in that paragraph assisted;
- full translation marks all targets assisted;
- assistance after an answer does not alter that saved answer;
- two concurrent answers with different keys return the first committed outcome and increment progress once;
- a wrong option returns correct option and all explanations;
- `dont_know` stores a first incorrect attempt with no selected option;
- the last first answer changes the practice to `completed`;
- a user cannot submit to another user's practice.

- [ ] **Step 2: Run answer tests and verify failure**

Run: `npm test --workspace=@context-reader/server -- modules/practice/answer.integration.test.ts`

Expected: FAIL because assistance and answer services are missing.

- [ ] **Step 3: Implement validated assistance events**

Add these strict shared contracts:

```ts
export const AssistanceRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('word_hint'), targetId: UuidSchema }).strict(),
  z.object({ kind: z.literal('paragraph_translation'), paragraphId: UuidSchema }).strict(),
  z.object({ kind: z.literal('full_translation') }).strict(),
]);
export const AssistanceResponseSchema = z.object({
  recorded: z.literal(true),
  hintMeaningZh: z.string().nullable(),
}).strict();
export const SubmitAnswerRequestSchema = z.discriminatedUnion('answerKind', [
  z.object({
    answerKind: z.literal('option'),
    questionId: UuidSchema,
    selectedOptionId: UuidSchema,
    elapsedMs: z.number().int().min(0).max(3600000),
  }).strict(),
  z.object({
    answerKind: z.literal('dont_know'),
    questionId: UuidSchema,
    elapsedMs: z.number().int().min(0).max(3600000),
  }).strict(),
]);
export type AssistanceRequest = z.infer<typeof AssistanceRequestSchema>;
export type AssistanceResponse = z.infer<typeof AssistanceResponseSchema>;
export type SubmitAnswerRequest = z.infer<typeof SubmitAnswerRequestSchema>;
```

Require `Idempotency-Key` and run `beginIdempotentOperation` with operation `record_assistance` and request material `{ practiceId, ...parsedBody }` before changing state. Verify the referenced target or paragraph belongs to the practice and user before insert. For `word_hint`, insert the event, finish the idempotency record, and return its vocabulary item's `meaningZh` in the same transaction; a replay returns the same response without a second event. Other kinds return `hintMeaningZh: null`. On the first valid assistance event, transition `ready` to `in_progress` and set `startedAt` once.

- [ ] **Step 4: Implement one-transaction first-answer grading**

```ts
export type SubmitAnswerInput = {
  userId: string;
  practiceId: string;
  questionId: string;
  answerKind: 'option';
  selectedOptionId: string;
  elapsedMs: number;
  idempotencyKey: string;
} | {
  userId: string;
  practiceId: string;
  questionId: string;
  answerKind: 'dont_know';
  elapsedMs: number;
  idempotencyKey: string;
};
```

Run `beginIdempotentOperation` with operation `submit_answer` and request material `{ practiceId, ...parsedBody }`, then lock the question and any existing answer. A reused key with a changed practice, question, or answer fails with `IDEMPOTENCY_KEY_REUSED`. If an answer already exists under a different valid key, return that immutable first result and finish the new idempotency record without changing progress. For `option`, validate the selected option ID; for `dont_know`, persist a null selection and force `isCorrect = false`. Calculate assistance from events with `shownAt <= submittedAt`, insert the answer, upsert `learning_progress` exactly once, set the vocabulary item to `reviewing`, transition `ready` to `in_progress` and set `startedAt` once, count answered questions, and complete the practice when counts match. Finish the idempotency record and return feedback only after the insert succeeds.

- [ ] **Step 5: Run evidence and practice retrieval tests**

Run: `npm test --workspace=@context-reader/server -- modules/practice`

Expected: PASS. Re-fetching the practice after one answer reveals feedback only for that question.

- [ ] **Step 6: Commit answer evidence**

```bash
git add packages/contracts/src server/src/modules/practice
git commit -m "feat: grade first answers and track evidence"
```

### Task 11: Add vocabulary/dashboard queries and production HTTP hardening

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `server/src/modules/vocabulary/routes.ts`
- Create: `server/src/modules/dashboard/routes.ts`
- Create: `server/src/modules/dashboard/service.ts`
- Create: `server/src/plugins/security.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/modules/dashboard/dashboard.integration.test.ts`
- Test: `server/src/plugins/security.test.ts`

**Interfaces:**
- Produces: `GET /v1/vocabulary-items`, `GET /v1/dashboard`, real readiness checking, CORS, body limits, and dual rate limits.
- Consumes: authenticated user and all completed backend modules.

- [ ] **Step 1: Write failing query and hardening tests**

Test cursor pagination ordered by `(createdAt desc, id desc)`, unknown/malformed cursors, dashboard counts, current incomplete practice, remaining quota, rejected disallowed Web origins, a 32 KiB body limit, and a token bucket that returns `429 RATE_LIMITED` without logging the token.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test --workspace=@context-reader/server -- modules/dashboard plugins/security.test.ts`

Expected: FAIL because routes and security plugin do not exist.

- [ ] **Step 3: Implement cursor-safe vocabulary and dashboard queries**

Encode cursors as base64url JSON `{ createdAt: ISOString, id: UUID }`, validate after decoding, default `limit` to 20, and fetch `limit + 1` with a maximum limit of 50. Dashboard selects the newest practice in `queued/generating/validating/ready/in_progress` ordered by `(createdAt desc, id desc)` as the incomplete practice and returns:

```ts
export const DashboardDtoSchema = z.object({
  incompletePracticeId: UuidSchema.nullable(),
  vocabularyCount: z.number().int().nonnegative(),
  reviewingCount: z.number().int().nonnegative(),
  completedPracticeCount: z.number().int().nonnegative(),
  remainingFreePractices: z.number().int().nonnegative(),
}).strict();
export type DashboardDto = z.infer<typeof DashboardDtoSchema>;
```

- [ ] **Step 4: Register HTTP protections and real readiness**

Set Fastify `bodyLimit: 32768`. Configure CORS with an exact origin allowlist and no credentials; permit requests with no `Origin` header so native apps and server smoke tests continue to work. Apply a high IP limit globally, then stricter token-scoped limits to anonymous registration and AI-creating endpoints. Map limit failures to `RATE_LIMITED` and preserve an integer `Retry-After` header. `/health/ready` runs `select 1` with a 2,000 ms abort deadline and maps failure to `DATABASE_UNAVAILABLE`. Health routes bypass auth and token-scoped limiting. Document that production is served only behind an HTTPS-terminating proxy; do not trust arbitrary forwarded-protocol headers when the server is directly exposed.

- [ ] **Step 5: Run the complete backend suite and build**

Run: `npm test --workspace=@context-reader/server && npm run typecheck --workspace=@context-reader/server && npm run build --workspace=@context-reader/server`

Expected: PASS and no unhandled rejection or open-handle warning.

- [ ] **Step 6: Commit query APIs and hardening**

```bash
git add packages/contracts/src server/src/modules/dashboard server/src/modules/vocabulary server/src/plugins server/src/app.ts server/src/index.ts
git commit -m "feat: expose dashboard and secure the API"
```

### Task 12: Add the Expo installation credential and typed API client

**Files:**
- Modify: `app/package.json`
- Modify: `app/app.json`
- Create: `app/jest.config.js`
- Create: `app/src/api/storage.ts`
- Create: `app/src/api/installation.ts`
- Create: `app/src/api/client.ts`
- Create: `app/src/api/practices.ts`
- Test: `app/src/api/client.test.ts`
- Test: `app/src/api/installation.test.ts`

**Interfaces:**
- Produces: `getInstallationToken`, `registerAnonymous`, `apiRequest`, `createPractice`, `getPractice`, `requestTranslation`, `getTranslation`, `recordAssistance`, `submitAnswer`, `getVocabulary`, and `getDashboard`.
- Consumes: all shared DTO schemas and the server's `/v1` contract.

- [ ] **Step 1: Install SDK-compatible security packages**

Run: `npm exec --workspace=app expo install expo-secure-store expo-crypto`

Expected: `app/package.json` receives Expo SDK 54-compatible versions and the root lock updates without changing `expo`, `react`, or `react-native`. Add `expo-secure-store` to `app.json`'s plugin list for native builds.

Run: `npm install --workspace=app zod@4.5.4`

Expected: the app declares the validator it imports directly rather than relying on a hoisted transitive dependency.

Run: `npm install --save-dev --workspace=app jest@30.5.1 jest-expo@54.0.18 @types/jest@30.0.0 @testing-library/react-native@14.0.1 test-renderer@1.2.0`

Expected: the client receives an Expo-compatible Jest stack. Add `"test": "jest --runInBand"` to `app/package.json` and create:

```js
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@context-reader/contracts$': '<rootDir>/../packages/contracts/src/index.ts',
  },
};
```

- [ ] **Step 2: Write failing installation and transport tests**

Use Jest mocks for SecureStore, Expo Crypto, `Platform.OS`, and `fetch`. Assert the first native token is 64 lowercase hex characters, concurrent calls create one token, later calls reuse it, Web returns `NATIVE_AUTH_REQUIRED` without touching AsyncStorage, registration sends the bearer header, a non-2xx public envelope becomes `ApiError`, a malformed success body becomes `INVALID_SERVER_RESPONSE`, and no error string includes the token.

- [ ] **Step 3: Implement the installation credential**

```ts
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export class InstallationCredentialUnavailableError extends Error {
  readonly code = 'NATIVE_AUTH_REQUIRED';
}

const INSTALLATION_TOKEN_KEY = 'context_reader_installation_token_v1';
let inFlight: Promise<string> | null = null;

export async function getInstallationToken(): Promise<string> {
  if (Platform.OS === 'web') {
    throw new InstallationCredentialUnavailableError(
      '云端练习需要 iOS 或 Android 的安全凭据存储',
    );
  }
  const stored = await SecureStore.getItemAsync(INSTALLATION_TOKEN_KEY);
  if (stored) return stored;
  if (!inFlight) {
    inFlight = Crypto.getRandomBytesAsync(32).then(async (bytes) => {
      const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      await SecureStore.setItemAsync(INSTALLATION_TOKEN_KEY, token);
      return token;
    }).finally(() => { inFlight = null; });
  }
  return inFlight;
}

export async function createIdempotencyKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
```

Define `InstallationCredentialUnavailableError` in the same module and test this branch by mocking `Platform.OS` to `web`; never fall back to AsyncStorage or browser storage for the bearer credential. Home/dashboard UI catches this typed error and keeps the Expo Web preview renderable without attempting an authenticated request.

- [ ] **Step 4: Implement the validated HTTP client**

```ts
import { PublicErrorSchema } from '@context-reader/contracts';
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromUnknown(input: unknown): ApiError {
    const parsed = PublicErrorSchema.safeParse(input);
    if (!parsed.success) {
      return new ApiError('INVALID_SERVER_RESPONSE', '服务返回了无法识别的数据', true);
    }
    const { code, message, retryable, requestId } = parsed.data.error;
    return new ApiError(code, message, retryable, requestId);
  }
}

export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new ApiError('API_NOT_CONFIGURED', '尚未配置服务地址', false);
  const token = await getInstallationToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('NETWORK_ERROR', '网络连接失败', true);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('INVALID_SERVER_RESPONSE', '服务返回了无法识别的数据', true);
  }
  if (!response.ok) throw ApiError.fromUnknown(json);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError('INVALID_SERVER_RESPONSE', '服务返回了无法识别的数据', true);
  return parsed.data;
}
```

Every mutating wrapper accepts a key returned by `createIdempotencyKey`; UI code creates it once and retains it with its in-flight operation so a retry sends the same key.

- [ ] **Step 5: Run client tests without changing the SDK baseline**

Run: `npm test --workspace=app -- src/api && npm run typecheck --workspace=app && npm why react-native`

Expected: PASS and only React Native `0.81.5` appears.

- [ ] **Step 6: Commit the client transport**

```bash
git add app/package.json app/app.json app/src/api package-lock.json
git commit -m "feat: add secure Expo API client"
```

### Task 13: Connect word entry and durable generation status

**Files:**
- Create: `app/src/features/practice/VocabularyInputList.tsx`
- Create: `app/src/features/practice/usePracticePolling.ts`
- Create: `app/src/app/practice/new.tsx`
- Create: `app/src/app/practice/[id]/generating.tsx`
- Modify: `app/src/app/(tabs)/index.tsx`
- Test: `app/src/features/practice/usePracticePolling.test.ts`

**Interfaces:**
- Produces: `/practice/new`, `/practice/[id]/generating`, draft persistence, and a resume-safe polling hook.
- Consumes: Task 12 client functions and current theme/components.

- [ ] **Step 1: Write a failing polling state-machine test**

With fake timers, return `queued`, `generating`, then `ready`; assert the hook waits each server-provided `pollAfterMs`, emits each state once, stops after ready, and cancels on unmount. Move mocked `AppState` to background, advance timers, and assert no request occurs; move it to active and assert one immediate refresh. Test `failed` stops and exposes its public message.

- [ ] **Step 2: Run the hook test and verify failure**

Run: `npm test --workspace=app -- usePracticePolling.test.ts`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Build the controlled 1–10-row input component**

Each row contains `term`, `meaningZh`, and collapsible optional `sourceSentence`. Start with one row; disable remove at one and add at ten. Display inline errors from `VocabularyInputSchema` and reject exact normalized duplicates before submission. Keep the entire draft under AsyncStorage key `context_reader_practice_draft_v1`.

- [ ] **Step 4: Implement the first-use form flow**

The screen shows the 14+ confirmation until local key `context_reader_age_confirmed_v1` is set. Submission order is: validate form, persist the submitted body and one idempotency key, call `registerAnonymous(true)`, create the practice with the same retained key on retries, store `context_reader_active_practice_id_v1`, then navigate to generating. Keep the submitted draft until the practice becomes `ready`, so a final generation failure can return to the same inputs; clear it only after readiness.

- [ ] **Step 5: Implement polling and resume**

The generating screen displays only `正在排队`, `正在生成`, or `正在检查`, plus a safe retry action for network errors. Pause timers while `AppState` is not active and fetch immediately when it becomes active. On `ready`, clear the submitted draft and retained create-operation key, then call `router.replace({ pathname: '/practice/[id]/read', params: { id } })`. On final failure, preserve the draft but clear the failed create-operation key; display the public error and a button back to the form, where the next explicit submission receives a new key. Do not create a replacement automatically.

- [ ] **Step 6: Wire the reading-tab CTA**

Change the existing banner title to `用你的生词生成长文练习`, subtitle to `1–10 个具体义项`, button label to `录入词义`, and add `onPress={() => router.push('/practice/new')}`. If dashboard later reports an incomplete practice, show `继续上次练习` and route to the server-reported ID.

- [ ] **Step 7: Verify navigation and commit**

Run: `npm test --workspace=app -- usePracticePolling.test.ts && npm run typecheck --workspace=app && npm run lint --workspace=app`

Expected: PASS with no route type errors.

```bash
git add app/src/features/practice app/src/app/practice app/src/app/'(tabs)'/index.tsx
git commit -m "feat: add vocabulary practice creation flow"
```

### Task 14: Add article reading, highlights, and translations

**Files:**
- Create: `app/src/features/practice/ArticleParagraph.tsx`
- Create: `app/src/features/practice/useTranslation.ts`
- Create: `app/src/app/practice/[id]/read.tsx`
- Test: `app/src/features/practice/ArticleParagraph.test.tsx`
- Test: `app/src/features/practice/useTranslation.test.ts`

**Interfaces:**
- Produces: safe segment rendering, paragraph/full translation display, assistance recording, and `/practice/[id]/read`.
- Consumes: ready `PracticeDto`, translation API, assistance API, AsyncStorage.

- [ ] **Step 1: Write failing render and assistance-order tests**

Render segments containing ordinary text and one target. Assert only the target receives accent styling, tapping it calls `recordAssistance({ kind: 'word_hint', targetId })`, and the returned `hintMeaningZh` appears only after that call succeeds. Assert no HTML interpretation occurs. For translation, assert the sequence is request → poll ready → render translation → record assistance; a failed or abandoned request must not record assistance.

- [ ] **Step 2: Run focused client tests and verify failure**

Run: `npm test --workspace=app -- ArticleParagraph.test.tsx useTranslation.test.ts`

Expected: FAIL because article components do not exist.

- [ ] **Step 3: Implement safe nested-text rendering**

```tsx
import type { ArticleSegment } from '@context-reader/contracts';
import { StyleSheet, Text } from 'react-native';

interface Props {
  segments: ArticleSegment[];
  targetColor: string;
  onTargetPress: (targetId: string) => void;
}

export function ArticleParagraph({ segments, targetColor, onTargetPress }: Props) {
  return (
    <Text style={styles.paragraph}>
      {segments.map((segment, index) => (
        <Text
          key={`${index}-${segment.targetId ?? 'plain'}`}
          onPress={segment.targetId ? () => onTargetPress(segment.targetId) : undefined}
          style={segment.targetId ? { color: targetColor, fontWeight: '600' } : undefined}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  paragraph: { fontSize: 17, lineHeight: 30, marginBottom: 18 },
});
```

- [ ] **Step 4: Implement translation state and evidence timing**

`useTranslation` retains one request idempotency key per scope, polls `GET /v1/translations/:id`, exposes `idle/loading/ready/failed`, and calls `recordAssistance` only from the UI callback that changes the translation from hidden to visible. Reopening an already visible cached translation reuses the assistance idempotency key. A network retry keeps the existing keys; an explicit retry after terminal translation failure creates a new translation-request key as required by Task 9, while still deduplicating through the server cache identity.

- [ ] **Step 5: Build the reading screen**

Fetch the practice, redirect non-ready states to generating, render title and paragraphs, and retain one assistance idempotency key per target while its word-hint call is pending or retryable. Reveal the supplied meaning in a small popover only after that atomic word-hint request succeeds. Provide each paragraph a `翻译本段` control and one `全文翻译` control. Save the latest visible paragraph index as `context_reader_reading_position_<practiceId>`. The bottom action routes to `/practice/[id]/quiz`.

- [ ] **Step 6: Run client checks and commit**

Run: `npm test --workspace=app -- ArticleParagraph useTranslation && npm run typecheck --workspace=app && npm run lint --workspace=app`

Expected: PASS.

```bash
git add app/src/features/practice app/src/app/practice/'[id]'/read.tsx
git commit -m "feat: add translated practice reader"
```

### Task 15: Add resumable quizzes, results, vocabulary, and dashboard data

**Files:**
- Create: `app/src/features/practice/QuizQuestion.tsx`
- Create: `app/src/app/practice/[id]/quiz.tsx`
- Create: `app/src/app/practice/[id]/result.tsx`
- Modify: `app/src/app/(tabs)/words.tsx`
- Modify: `app/src/app/(tabs)/index.tsx`
- Test: `app/src/features/practice/QuizQuestion.test.tsx`

**Interfaces:**
- Produces: first-attempt quiz UX, feedback/result screens, live vocabulary list, and dashboard resume summary.
- Consumes: practice, answer, vocabulary, and dashboard APIs.

- [ ] **Step 1: Write a failing first-submit UI test**

Assert no explanation or correct styling appears initially, normal submit stays disabled until one option is selected, `我不知道` submits `answerKind: 'dont_know'`, pressing either submit path calls the API once with a retained idempotency key, returned feedback locks all options, and remounting from a `submittedAnswer` does not submit again.

- [ ] **Step 2: Run the component test and verify failure**

Run: `npm test --workspace=app -- QuizQuestion.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement question and feedback rendering**

The component accepts exactly:

```ts
interface QuizQuestionProps {
  question: PublicQuestion;
  onSubmit: (
    answer: { answerKind: 'option'; selectedOptionId: string } | { answerKind: 'dont_know' },
    elapsedMs: number,
    idempotencyKey: string,
  ) => Promise<AnswerResult>;
  onContinue: () => void;
}
```

Generate the idempotency key when the question first mounts, preserve it through retry, measure elapsed time from first display, provide a separate `我不知道` action, and render the server's correct option plus all option explanations after either submission path.

- [ ] **Step 4: Build resumable quiz and result routes**

On load, select the first question with `submittedAnswer === null`; answered questions remain locked. After each answer re-fetch the practice so server state controls progress. Route to results once every question has an answer. Results show correct count, assisted count, total count, and a button that clears `context_reader_active_practice_id_v1` before returning to the reading tab.

Implement one resume resolver used by the home CTA. Prefer the locally stored active practice ID, otherwise use `dashboard.incompletePracticeId`, fetch that practice once, and route by durable state: `queued/generating/validating` to `generating`; `ready/in_progress` with no submitted answers to `read`; `ready/in_progress` with any submitted answer to `quiz`; `completed` to `result`; `failed` back to `new` with the preserved draft. Never call `createPractice` from resume logic.

- [ ] **Step 5: Replace mock vocabulary and load dashboard state**

The words tab calls `getVocabulary`, maps `pending` to `待复习`, `reviewing` to `复习中`, `mastered` to `已掌握`, and `self_reported` to `用户自报已会`, then renders source sentence only when present. Add loading, empty, retry, and cursor-load states. The home tab calls `getDashboard` on focus to show remaining free practices and a resume CTA without replacing unrelated mock content.

- [ ] **Step 6: Run all client checks and commit**

Run: `npm test --workspace=app && npm run typecheck --workspace=app && npm run lint --workspace=app`

Expected: PASS with no mock import remaining in `words.tsx`.

```bash
git add app/src/features/practice app/src/app/practice app/src/app/'(tabs)'/words.tsx app/src/app/'(tabs)'/index.tsx
git commit -m "feat: complete cloud practice client flow"
```

### Task 16: Document, harden, and run the real end-to-end acceptance

**Files:**
- Create: `README.md`
- Create: `server/README.md`
- Create: `server/scripts/live-smoke.ts`
- Create: `server/scripts/check-client-secrets.ts`
- Modify: `server/package.json`
- Modify: `app/.env.example`
- Modify: `app/.gitignore`

**Interfaces:**
- Produces: repeatable onboarding, migration, development, check, and live-smoke commands.
- Consumes: the complete vertical slice from Tasks 1–15.

- [ ] **Step 1: Add an opt-in smoke script before running live services**

The script must refuse to run unless `RUN_LIVE_SMOKE=1`. It creates a fresh random installation token and idempotency keys, registers 14+, creates a three-word practice (`resilient/有韧性的`, `ambiguous/模棱两可的`, `meticulous/一丝不苟的`), polls with the server-provided delay for at most 120 seconds, and asserts every target appears. It requests one paragraph translation and one full translation, records each assistance event only after receiving non-empty Chinese text, submits one guaranteed-correct answer by selecting the option whose label equals the supplied meaning, and submits `dont_know` for a second question to guarantee an incorrect answer. It prints only IDs, statuses, counts, model name, and elapsed milliseconds.

Add:

```json
{
  "scripts": {
    "smoke:live": "node --env-file=../app/.env --import tsx scripts/live-smoke.ts"
  }
}
```

- [ ] **Step 2: Write exact environment examples and startup documentation**

`app/.env.example` lists, with blank values and safe defaults, every server variable from design section 15 plus `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000`. Documentation must state that a physical phone uses the development machine's LAN IP instead of `localhost`, that migrations are explicit, and that integration tests create only `app_test_*` schemas.

Document these commands exactly:

```bash
npm install
npm run db:migrate --workspace=@context-reader/server
npm run dev
npm run dev:app
npm run check
RUN_LIVE_SMOKE=1 npm run smoke:live --workspace=@context-reader/server
```

- [ ] **Step 3: Run static secret and bundle checks**

Run: `rg -n "EVOLINK_API_KEY|DATABASE_URL|postgres(ql)?://" app/src app/assets --glob '!*.test.*'`

Expected: no matches.

Create `server/scripts/check-client-secrets.ts` so actual values are checked without ever printing them:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
  }));
  return groups.flat();
}

const exportDirectory = new URL('../../app/dist-smoke/', import.meta.url).pathname;
const secrets = ['EVOLINK_API_KEY', 'DATABASE_URL']
  .map((name) => ({ name, value: process.env[name] }))
  .filter((entry): entry is { name: string; value: string } => Boolean(entry.value));

for (const path of await filesUnder(exportDirectory)) {
  const content = await readFile(path);
  const text = content.toString('utf8');
  for (const secret of secrets) {
    if (text.includes(secret.value)) {
      throw new Error(`${secret.name} leaked into the client export`);
    }
  }
}
console.log(`Checked ${secrets.length} server secrets; no client leak found.`);
```

Run: `npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke`

Add `dist-smoke/` to `app/.gitignore`. Expected: export succeeds. Then run `node --env-file=app/.env --import tsx server/scripts/check-client-secrets.ts`; expected: `no client leak found` without printing any secret value. Run the same ripgrep against `app/dist-smoke`; expected: no secret variable names or PostgreSQL URL. After both checks, remove only the generated directory with `rm -rf app/dist-smoke`.

- [ ] **Step 4: Run the full automated gate**

Run: `npm run check && npm run build`

Expected: every contract, server, database, and client test passes; both TypeScript projects pass; Expo lint passes; server build succeeds.

- [ ] **Step 5: Run live database/API smoke acceptance**

Start `npm run dev` in one terminal, wait for `/health/ready` to return `200`, then run:

```bash
RUN_LIVE_SMOKE=1 npm run smoke:live --workspace=@context-reader/server
```

Expected: one practice reaches `ready` within 120 seconds, both translations reach `ready`, one correct and one `dont_know` answer are accepted, and replaying the same idempotency keys returns the same resource IDs/results without changing remaining quota or progress counts.

- [ ] **Step 6: Verify the Expo flow interactively**

Start `npm run dev:app` and run the full authenticated flow on one available iOS or Android target, because the product PRD targets native and installation credentials live in SecureStore. Also open Expo Web as a compile/render smoke check without invoking SecureStore-backed authentication. On native verify: first-use 14+ confirmation, three-word creation, background/resume during generation, highlights, paragraph/full translation, one correct and one incorrect answer, results, live vocabulary, and reopening the completed practice. Record platform and result in `server/README.md` under `Verified locally` without article text or user inputs.

- [ ] **Step 7: Inspect the final diff and commit documentation/fixes**

Run: `git diff --check && git status --short && git diff --stat HEAD`

Expected: no whitespace errors, no `.env`, database dump, generated Expo output, or unrelated `.trash-app-tmp` file staged.

```bash
git add README.md server/README.md server/scripts/live-smoke.ts server/scripts/check-client-secrets.ts server/package.json app/.env.example app/.gitignore package-lock.json
git commit -m "docs: finish cloud core backend handoff"
```

If the acceptance run proves an implementation defect, return to the task that owns that file, add a regression test, make it pass, and commit that focused fix before creating this documentation commit.

---

## Final Verification Checklist

- [ ] `git status --short` contains no secret or generated artifact.
- [ ] `npm run check` exits 0.
- [ ] `npm run build` exits 0.
- [ ] Re-running migrations exits 0 without changing the Schema.
- [ ] Two workers cannot claim one active lease.
- [ ] A failed generation releases its reserved free practice.
- [ ] A ready generation commits exactly one free practice.
- [ ] Unanswered practice JSON contains no correct answer or explanation.
- [ ] Full, paragraph, and word assistance affect only the specified targets.
- [ ] Duplicate answer submission does not alter progress.
- [ ] Translation generation alone does not count as assistance.
- [ ] The Expo bundle contains no server secret names or values.
- [ ] A real practice and translation complete through EvoLink within the explicit deadline or return a clean retryable/final error.
- [ ] App restart resumes the durable server state without creating a new practice.
