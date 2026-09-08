# Article Import Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete server-side article-import platform for URL, pasted text, ordered photo batches, local files, and ten-minute computer uploads, ending in an editable preview, an owner-only private article, and cached paragraph/full translation.

**Architecture:** Extend the existing Fastify modular monolith with bounded `imports`, `articles`, and `computer-upload` modules. Every source converges on one PostgreSQL-backed import state machine; jobs use the existing lease runner, binary inputs live temporarily in Neon `bytea`, and source adapters return one normalized `{ title, text }` boundary before confirmation writes immutable ordered paragraphs.

**Tech Stack:** Node.js 22.13+, TypeScript 5.9.2, Fastify 5.12.3, Zod 4.5.4, Drizzle ORM 0.45.2, PostgreSQL/Neon through `pg` 8.23.0, Vitest 5.0.0, EvoLink OpenAI-compatible APIs, `@fastify/multipart` 10.1.1, `@fastify/cookie` 11.1.2, `@fastify/formbody` 8.0.2, `@mozilla/readability` 0.6.0, `linkedom` 0.18.13, `mammoth` 1.12.2, `pdf-parse` 2.4.5, `file-type` 22.0.2, `sharp` 0.35.4, `franc-min` 6.2.0, `undici` 7.29.1, `ipaddr.js` 2.5.0, and `heic-convert` 2.1.0.

**Approved design:** `docs/superpowers/specs/2026-09-08-article-import-design.md`

## Global Constraints

- This plan implements the backend first; Expo button wiring is a separate follow-on plan after every backend acceptance gate here passes.
- Keep Expo SDK 54, React 19.1.0, and React Native 0.81.5 unchanged.
- Keep the existing Fastify modular monolith, Neon PostgreSQL, PostgreSQL lease queue, anonymous bearer identity, and EvoLink provider boundary.
- Do not change generated-practice tables, answer evidence, vocabulary behavior, quiz behavior, or the three-practice quota.
- Accept TXT, Markdown/HTML, PDF, DOCX, JPEG, PNG, WebP, GIF, and HEIC only; do not render scanned PDF pages on the server.
- Accept 1–10 album images, at most 10,485,760 bytes per asset and 31,457,280 bytes in aggregate.
- Accept at most 131,072 source-text bytes and at most 5,000 English words; reject instead of truncating.
- Fetch at most 5,242,880 response bytes for 15,000 ms, follow at most five redirects, and validate plus pin every DNS result before each connection.
- Give an article-import job at most three total attempts and a 300,000 ms resource deadline.
- Give computer-upload codes exactly 600,000 ms; keep retryable assets at most 86,400,000 ms and unconfirmed previews at most 604,800,000 ms.
- Store uploaded bytes only in `import_assets.content bytea`; delete them on preview success, terminal failure, cancellation, expiry, and audited TTL cleanup.
- Store all timestamps as UTC `timestamptz` and all resource identifiers as UUIDs.
- Never put `DATABASE_URL`, EvoLink credentials, upload codes, capability tokens/cookies, source URLs, filenames, request bodies, extracted text, preview text, OCR data URLs, translations, or article text in logs or public failures.
- Keep the global JSON body limit at 32 KiB; only preview editing gets 128 KiB and source uploads use scoped streaming limits.
- Every `/v1` mutation except raw asset PUT requires an `Idempotency-Key`; raw asset replay uses `(importId, position, server-computed SHA-256)` instead of an idempotency record.
- Authenticate ownership again inside every mutating transaction; return `NOT_FOUND` for another user's resource.
- Use original synthetic prose in tests; no copyrighted article fixture or user file may enter the repository.
- Never drop, truncate, or recreate the configured database's `public` schema; integration tests stay inside random `app_test_*` schemas.
- Use `apply_patch` for hand-written changes, preserve unrelated user edits, and make one focused commit after each green task.

---

## File Map

### Shared contracts and server foundation

- Modify `packages/contracts/src/index.ts`: strict import, computer-session, private-article, and article-translation DTOs.
- Modify `packages/contracts/src/index.test.ts`: public-shape, strictness, state-shape, and size-boundary tests.
- Modify `server/package.json` and `package-lock.json`: pin the parsing, upload, image, language, URL, and Fastify plugins listed above.
- Modify `server/src/config/env.ts` and `server/src/config/env.test.ts`: exact import limits, explicit public origin, and vision configuration.
- Modify the explicit `loadConfig` test callers listed in Task 1: supply `PUBLIC_SERVER_ORIGIN=http://localhost:3000`.
- Modify `server/src/core/errors.ts`: stable import and upload public error codes.
- Create `server/src/http/validation.ts`: shared UUID and idempotency-key parsing.
- Create `server/src/http/stream.ts`: exact-length, bounded, hashing stream reader.
- Modify `server/src/modules/practice/routes.ts` and `server/src/modules/translation/routes.ts`: consume shared HTTP validation without changing behavior.
- Modify `server/src/plugins/security.ts` and `server/src/plugins/security.test.ts`: allow PUT/PATCH and rate-limit new sensitive routes.

### Persistence and common import domain

- Modify `server/src/db/schema.ts`: import/article/session tables, enums, indexes, checks, and two new job kinds.
- Generate `server/drizzle/0001_article_imports.sql` plus Drizzle metadata with `--name article_imports`.
- Modify `server/src/db/schema.integration.test.ts`: migration idempotence and new database constraints.
- Create `server/src/modules/imports/state.ts` and `state.test.ts`: exhaustive transition policy.
- Create `server/src/modules/imports/content.ts` and `content.test.ts`: normalization, English validation, paragraphs, exact hash, and 64-bit SimHash.
- Create `server/src/modules/imports/repository.ts`: locked ownership reads and lease-safe state persistence.
- Create `server/src/modules/imports/service.ts`: lifecycle, preview edits, duplicate decisions, confirmation, retry, and cancellation.
- Create `server/src/modules/imports/serializer.ts`: state-safe `ArticleImportDto` projection.
- Create `server/src/modules/imports/routes.ts`: authenticated HTTP lifecycle and scoped raw parsers.
- Create `server/src/modules/imports/imports.integration.test.ts`: paste tracer bullet, isolation, idempotency, duplicates, and atomic confirmation.

### Articles and article translation

- Create `server/src/modules/articles/service.ts`, `routes.ts`, and `articles.integration.test.ts`: owner-only ordered private article reads.
- Create `server/src/modules/article-translation/service.ts`, `handler.ts`, `routes.ts`, and `article-translation.integration.test.ts`: separate article translation cache and worker.
- Create `server/src/modules/translation/validation.ts` and modify the existing translation handler/service tests: shared Han-text, moderation, and source-hash helpers without merging tables.
- Modify `server/src/modules/jobs/types.ts`, `runner-registration.test.ts`, `server/src/index.ts`, and `server/src/app.ts`: new job registrations and route composition.

### Source extraction

- Create `server/src/modules/imports/extractors/types.ts`: source-adapter contract.
- Create `server/src/modules/imports/extractors/html.ts` and `html.test.ts`: static Readability extraction.
- Create `server/src/modules/imports/extractors/url-policy.ts` and `url-policy.test.ts`: URL/DNS/IP rejection.
- Create `server/src/modules/imports/extractors/safe-fetch.ts` and `safe-fetch.test.ts`: pinned Undici fetch, redirects, limits, and aborts.
- Create `server/src/modules/imports/extractors/document.ts` and `document.test.ts`: magic-byte routing and TXT/HTML/DOCX/PDF parsing.
- Create `server/test/fixtures/import-documents.ts`: deterministic minimal in-memory DOCX/PDF/corruption fixtures.
- Create `server/src/modules/imports/extractors/image.ts` and `image.test.ts`: first-frame decode, HEIC conversion, resize, orientation, and metadata stripping.
- Create `server/src/modules/imports/extractors/ocr.ts` and `ocr.test.ts`: ordered four-image batching and response concatenation.
- Create `server/src/modules/imports/handler.ts` and `handler.integration.test.ts`: lease-owned extraction dispatch, automatic retry, preview persistence, and permanent-failure cleanup.
- Modify `server/src/infrastructure/ai/types.ts`, `evolink-client.ts`, `evolink-provider.ts`, `fake-provider.ts`, their tests, and `prompts.ts`: dedicated ordered vision OCR boundary.
- Create `server/src/types/heic-convert.d.ts`: narrow local declaration for the CommonJS converter.

### Computer upload, cleanup, and acceptance

- Create `server/src/modules/computer-upload/code.ts` and `code.test.ts`: Crockford code generation/normalization and constant-time capability checks.
- Create `server/src/modules/computer-upload/claim-limiter.ts` and `claim-limiter.test.ts`: two-key five-attempt sliding window.
- Create `server/src/modules/computer-upload/page.ts` and `page.test.ts`: CSP-safe scriptless forms.
- Create `server/src/modules/computer-upload/service.ts`, `routes.ts`, and `computer-upload.integration.test.ts`: session creation, claim, cookie capability, single upload, and phone polling.
- Create `server/src/modules/imports/cleanup.ts` and `cleanup.integration.test.ts`: draft/session/asset expiry sweeps.
- Create `server/src/modules/imports/cleanup-runner.ts` and `cleanup-runner.test.ts`: abortable periodic lifecycle.
- Modify `server/src/app.ts`, `server/src/index.ts`, `server/src/plugins/security.ts`, and their tests: route registration, redaction, error mapping, complete worker registry, and cleanup shutdown.
- Modify `server/scripts/live-smoke.ts`: preserve the practice smoke behavior.
- Create `server/scripts/import-live-smoke.ts`: real paste, OCR, confirmation, article read, and article translation smoke.
- Modify `server/scripts/check-client-secrets.ts`, `server/package.json`, `app/.env.example`, `README.md`, and `server/README.md`: configuration, commands, route/status docs, and source/export secret scans.

---

### Task 1: Extend contracts, configuration, public errors, and HTTP boundaries

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/index.test.ts`
- Modify: `server/package.json`
- Modify: `package-lock.json`
- Modify: `server/src/config/env.ts`
- Modify: `server/src/config/env.test.ts`
- Modify: `server/src/core/errors.ts`
- Create: `server/src/http/validation.ts`
- Create: `server/src/http/stream.ts`
- Test: `server/src/http/stream.test.ts`
- Modify: `server/src/modules/practice/routes.ts`
- Modify: `server/src/modules/translation/routes.ts`
- Modify: `server/src/app.test.ts`
- Modify: `server/src/modules/auth/auth.integration.test.ts`
- Modify: `server/src/modules/dashboard/dashboard.integration.test.ts`
- Modify: `server/src/modules/translation/translation.integration.test.ts`
- Modify: `server/src/modules/practice/get.integration.test.ts`
- Modify: `server/src/modules/practice/create.integration.test.ts`
- Modify: `server/src/modules/practice/answer.integration.test.ts`
- Modify: `server/src/plugins/security.ts`
- Modify: `server/src/plugins/security.test.ts`
- Modify: `app/.env.example`

**Interfaces:**
- Consumes: existing `UuidSchema`, `PublicFailureSchema`, `TranslationRequestSchema`, `PublicErrorSchema`, `ServerConfig`, `AppError`, and Fastify route conventions.
- Produces: `ArticleImportSourceKind`, `ArticleImportStatus`, `CreateArticleImportRequest`, `ArticleImportDto`, `UpdateImportPreviewRequest`, `ConfirmArticleImportRequest`, `ImportedArticleDto`, `CreatedComputerUploadSession`, `ComputerUploadSessionDto`, `ArticleTranslationDto`; `requireIdempotencyKey(value): string`; `parseUuidParam(params, name, message): string`; and `readBoundedStream(stream, limits): Promise<ReadStreamResult>`.

- [ ] **Step 1: Write failing contract, configuration, stream, and CORS tests**

Add contract cases that prove strict source unions, contiguous album positions, local-file cardinality, status-dependent fields, and the 5,000-word boundary:

```ts
const asset = {
  position: 0,
  mediaType: 'image/jpeg',
  byteSize: 1_024,
};

expect(CreateArticleImportRequestSchema.parse({
  sourceKind: 'album',
  assets: [asset],
})).toEqual({ sourceKind: 'album', assets: [asset] });
expect(CreateArticleImportRequestSchema.safeParse({
  sourceKind: 'album',
  assets: [{ ...asset, position: 1 }],
}).success).toBe(false);
expect(CreateArticleImportRequestSchema.safeParse({
  sourceKind: 'local_file',
  assets: [asset, { ...asset, position: 1 }],
}).success).toBe(false);
expect(CreateArticleImportRequestSchema.safeParse({
  sourceKind: 'url',
  url: 'https://example.com/story',
  extra: true,
}).success).toBe(false);

const pending = ArticleImportDtoSchema.parse({
  id: crypto.randomUUID(),
  sourceKind: 'url',
  status: 'queued',
  createdAt: new Date().toISOString(),
  expiresAt: new Date().toISOString(),
  pollAfterMs: 1_500,
  failure: null,
  preview: null,
  articleId: null,
});
expect(pending.pollAfterMs).toBe(1_500);
expect(ArticleImportDtoSchema.safeParse({
  ...pending,
  status: 'failed',
  pollAfterMs: 1_500,
  failure: { code: 'IMPORT_PARSE_FAILED', message: '解析失败', retryable: false },
}).success).toBe(false);
```

Add configuration expectations:

```ts
const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'secret',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
});
expect(config.publicServerOrigin).toBe('http://localhost:3000');
expect(config.EVOLINK_VISION_MODEL).toBe('deepseek-v4-flash-vision-exp');
expect(config.IMPORT_MAX_FILE_BYTES).toBe(10_485_760);
expect(config.IMPORT_MAX_TOTAL_BYTES).toBe(31_457_280);
expect(config.COMPUTER_UPLOAD_TTL_MS).toBe(600_000);
expect(() => loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'secret',
})).toThrow(/PUBLIC_SERVER_ORIGIN/u);
```

Add `stream.test.ts` with a three-chunk `Readable.from(...)`, an exact declared length, an overflow, a short body, and an aborted signal. Assert the successful digest equals `createHash('sha256').update(buffer).digest('hex')` and every failure is an `AppError` without body content in its message.

Extend the security test to send `OPTIONS` for PUT/PATCH and assert both methods occur in `access-control-allow-methods`.

- [ ] **Step 2: Run focused tests and verify the missing exports/modules**

Run:

```bash
npm test --workspace=@context-reader/contracts
npm test --workspace=@context-reader/server -- src/config/env.test.ts src/http/stream.test.ts src/plugins/security.test.ts
```

Expected: FAIL because import contracts, import configuration, and stream helpers are not defined.

- [ ] **Step 3: Add strict shared DTOs**

Append the following public shapes to `packages/contracts/src/index.ts`; keep every object strict and export each inferred type:

```ts
export const ArticleImportSourceKindSchema = z.enum([
  'url', 'paste', 'album', 'local_file', 'computer',
]);
export const ArticleImportStatusSchema = z.enum([
  'awaiting_upload', 'queued', 'processing', 'retryable',
  'preview_ready', 'confirmed', 'failed', 'expired', 'cancelled',
]);
export const ImportAssetMediaTypeSchema = z.enum([
  'text/plain',
  'text/markdown',
  'text/html',
  'application/xhtml+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/octet-stream',
]);
export const ImportAssetDescriptorSchema = z.object({
  position: z.number().int().min(0).max(9),
  mediaType: ImportAssetMediaTypeSchema,
  byteSize: z.number().int().positive().max(10_485_760),
}).strict();

const OrderedAlbumAssetsSchema = z.array(ImportAssetDescriptorSchema)
  .min(1).max(10)
  .superRefine((assets, context) => {
    assets.forEach((entry, index) => {
      if (entry.position !== index) {
        context.addIssue({
          code: 'custom',
          path: [index, 'position'],
          message: '图片位置必须从 0 连续排列',
        });
      }
    });
    if (assets.reduce((sum, entry) => sum + entry.byteSize, 0) > 31_457_280) {
      context.addIssue({ code: 'custom', message: '文件总大小不能超过 30 MB' });
    }
  });

const LocalFileAssetsSchema = z.array(ImportAssetDescriptorSchema)
  .length(1)
  .superRefine((assets, context) => {
    if (assets[0]?.position !== 0) {
      context.addIssue({
        code: 'custom',
        path: [0, 'position'],
        message: '本地文件位置必须是 0',
      });
    }
  });

export const CreateArticleImportRequestSchema = z.discriminatedUnion('sourceKind', [
  z.object({ sourceKind: z.literal('url'), url: z.url().max(2_048) }).strict(),
  z.object({ sourceKind: z.literal('paste') }).strict(),
  z.object({ sourceKind: z.literal('album'), assets: OrderedAlbumAssetsSchema }).strict(),
  z.object({ sourceKind: z.literal('local_file'), assets: LocalFileAssetsSchema }).strict(),
]);
export const UpdateImportPreviewRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  text: z.string().min(1),
}).strict();
export const ConfirmArticleImportRequestSchema = z.object({
  similarityDecision: z.enum(['open_existing', 'save_new_version']).optional(),
}).strict();

export const DuplicateArticleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({
    kind: z.literal('exact'),
    article: z.object({
      id: UuidSchema,
      title: z.string(),
      wordCount: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal('similar'),
    article: z.object({
      id: UuidSchema,
      title: z.string(),
      wordCount: z.number().int().positive(),
      hammingDistance: z.number().int().min(0).max(3),
    }).strict(),
  }).strict(),
]);

export const ArticleImportDtoSchema = z.object({
  id: UuidSchema,
  sourceKind: ArticleImportSourceKindSchema,
  status: ArticleImportStatusSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  pollAfterMs: z.number().int().positive().optional(),
  failure: PublicFailureSchema.nullable(),
  preview: z.object({
    title: z.string().min(1).max(160),
    text: z.string().min(1),
    wordCount: z.number().int().min(20).max(5_000),
    duplicate: DuplicateArticleSchema,
  }).strict().nullable(),
  articleId: UuidSchema.nullable(),
}).strict().superRefine((value, context) => {
  const polling = new Set(['awaiting_upload', 'queued', 'processing']);
  if (polling.has(value.status) !== (value.pollAfterMs !== undefined)) {
    context.addIssue({ code: 'custom', path: ['pollAfterMs'], message: '轮询字段与状态不匹配' });
  }
  if ((value.status === 'preview_ready') !== (value.preview !== null)) {
    context.addIssue({ code: 'custom', path: ['preview'], message: '预览字段与状态不匹配' });
  }
  if ((value.status === 'confirmed') !== (value.articleId !== null)) {
    context.addIssue({ code: 'custom', path: ['articleId'], message: '文章字段与状态不匹配' });
  }
  const failed = value.status === 'retryable' || value.status === 'failed';
  if (failed !== (value.failure !== null)) {
    context.addIssue({ code: 'custom', path: ['failure'], message: '失败字段与状态不匹配' });
  }
});

export const ImportedArticleDtoSchema = z.object({
  id: UuidSchema,
  sourceKind: ArticleImportSourceKindSchema,
  sourceUrl: z.url().nullable(),
  title: z.string().min(1).max(160),
  wordCount: z.number().int().min(20).max(5_000),
  importedAt: z.iso.datetime(),
  paragraphs: z.array(z.object({
    id: UuidSchema,
    position: z.number().int().nonnegative(),
    text: z.string().min(1),
  }).strict()).min(1),
}).strict();

export const CreatedComputerUploadSessionSchema = z.object({
  sessionId: UuidSchema,
  importId: UuidSchema,
  uploadUrl: z.url(),
  uploadCode: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/u),
  expiresAt: z.iso.datetime(),
}).strict();
export const ComputerUploadSessionDtoSchema = z.object({
  id: UuidSchema,
  importId: UuidSchema,
  status: z.enum(['awaiting_code', 'claimed', 'uploaded', 'expired']),
  expiresAt: z.iso.datetime(),
  articleImport: ArticleImportDtoSchema,
}).strict();
export const ArticleTranslationDtoSchema = TranslationDtoSchema;

export type ArticleImportSourceKind = z.infer<typeof ArticleImportSourceKindSchema>;
export type ArticleImportStatus = z.infer<typeof ArticleImportStatusSchema>;
export type ImportAssetDescriptor = z.infer<typeof ImportAssetDescriptorSchema>;
export type CreateArticleImportRequest = z.infer<typeof CreateArticleImportRequestSchema>;
export type UpdateImportPreviewRequest = z.infer<typeof UpdateImportPreviewRequestSchema>;
export type ConfirmArticleImportRequest = z.infer<typeof ConfirmArticleImportRequestSchema>;
export type ArticleImportDto = z.infer<typeof ArticleImportDtoSchema>;
export type ImportedArticleDto = z.infer<typeof ImportedArticleDtoSchema>;
export type CreatedComputerUploadSession = z.infer<typeof CreatedComputerUploadSessionSchema>;
export type ComputerUploadSessionDto = z.infer<typeof ComputerUploadSessionDtoSchema>;
export type ArticleTranslationDto = z.infer<typeof ArticleTranslationDtoSchema>;
```

- [ ] **Step 4: Pin backend dependencies and exact server configuration**

Add these dependency entries, run the root install once, and commit the resulting single lockfile:

```json
{
  "dependencies": {
    "@fastify/cookie": "11.1.2",
    "@fastify/formbody": "8.0.2",
    "@fastify/multipart": "10.1.1",
    "@mozilla/readability": "0.6.0",
    "file-type": "22.0.2",
    "franc-min": "6.2.0",
    "heic-convert": "2.1.0",
    "ipaddr.js": "2.5.0",
    "linkedom": "0.18.13",
    "mammoth": "1.12.2",
    "pdf-parse": "2.4.5",
    "sharp": "0.35.4",
    "undici": "7.29.1"
  }
}
```

Extend `RawEnvSchema` with exactly:

```ts
PUBLIC_SERVER_ORIGIN: z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}, '必须是不含路径的 HTTP(S) origin'),
EVOLINK_VISION_MODEL: z.string().min(1).default('deepseek-v4-flash-vision-exp'),
EVOLINK_VISION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
IMPORT_MAX_TEXT_BYTES: z.coerce.number().int().positive().default(131_072),
IMPORT_MAX_FILE_BYTES: z.coerce.number().int().positive().default(10_485_760),
IMPORT_MAX_TOTAL_BYTES: z.coerce.number().int().positive().default(31_457_280),
IMPORT_FETCH_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
IMPORT_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
IMPORT_JOB_DEADLINE_MS: z.coerce.number().int().positive().default(300_000),
COMPUTER_UPLOAD_TTL_MS: z.coerce.number().int().positive().default(600_000),
IMPORT_ASSET_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
IMPORT_DRAFT_TTL_MS: z.coerce.number().int().positive().default(604_800_000),
```

Add `publicServerOrigin: result.data.PUBLIC_SERVER_ORIGIN.replace(/\/$/u, '')` to the returned config. Supply `PUBLIC_SERVER_ORIGIN: 'http://localhost:3000'` to every existing test fixture that calls `loadConfig`; do not give this field a production default. Add the same names and exact values to `app/.env.example`, with `PUBLIC_SERVER_ORIGIN=` blank.

- [ ] **Step 5: Add public codes and shared request validators**

Add the twelve stable codes to `errorCodes`:

```ts
'IMPORT_UNSUPPORTED_TYPE',
'IMPORT_TOO_LARGE',
'IMPORT_CONTENT_INVALID',
'IMPORT_NOT_ENGLISH',
'IMPORT_FETCH_BLOCKED',
'IMPORT_FETCH_FAILED',
'IMPORT_PARSE_FAILED',
'IMPORT_OCR_FAILED',
'IMPORT_DEADLINE_EXCEEDED',
'UPLOAD_SESSION_EXPIRED',
'UPLOAD_SESSION_USED',
'SIMILAR_ARTICLE_REQUIRES_DECISION',
```

Create `server/src/http/validation.ts`:

```ts
import { UuidSchema } from '@context-reader/contracts';

import { AppError } from '../core/errors';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  return value;
}

export function parseUuidParam(
  params: unknown,
  name: string,
  message: string,
): string {
  const value = typeof params === 'object' && params !== null
    ? (params as Record<string, unknown>)[name]
    : undefined;
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', message, 400);
  return parsed.data;
}
```

Replace the duplicated local helpers in practice and translation routes with these exports, leaving their response behavior unchanged.

- [ ] **Step 6: Implement the bounded hashing stream reader**

Create `server/src/http/stream.ts` with this exact boundary:

```ts
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { AppError } from '../core/errors';

export interface ReadStreamResult {
  content: Buffer;
  byteSize: number;
  sha256: string;
}

export async function readBoundedStream(
  stream: Readable,
  input: {
    contentLength: number;
    maxBytes: number;
    signal?: AbortSignal;
  },
): Promise<ReadStreamResult> {
  if (!Number.isInteger(input.contentLength) || input.contentLength < 0) {
    throw new AppError('VALIDATION_ERROR', '必须提供准确的 Content-Length', 411);
  }
  if (input.contentLength > input.maxBytes) {
    throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
  }

  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const rawChunk of stream) {
    input.signal?.throwIfAborted();
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    byteSize += chunk.byteLength;
    if (byteSize > input.maxBytes || byteSize > input.contentLength) {
      stream.destroy();
      throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
    }
    chunks.push(chunk);
    hash.update(chunk);
  }
  input.signal?.throwIfAborted();
  if (byteSize !== input.contentLength) {
    throw new AppError('VALIDATION_ERROR', '上传长度与 Content-Length 不一致', 400);
  }
  return { content: Buffer.concat(chunks), byteSize, sha256: hash.digest('hex') };
}
```

- [ ] **Step 7: Allow required methods and rate-limit sensitive mutations**

Set CORS methods to `['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'OPTIONS']`. Add these route patterns to `tokenLimitedRoutes`:

```ts
'POST /v1/imports',
'PUT /v1/imports/:id/source-text',
'PUT /v1/imports/:id/assets/:position',
'POST /v1/imports/:id/process',
'PATCH /v1/imports/:id/preview',
'POST /v1/imports/:id/confirm',
'POST /v1/imports/:id/retry',
'POST /v1/imports/:id/cancel',
'POST /v1/articles/:id/translations',
'POST /v1/computer-upload-sessions',
```

Run:

```bash
npm install
npm test --workspace=@context-reader/contracts
npm test --workspace=@context-reader/server -- src/config/env.test.ts src/http/stream.test.ts src/plugins/security.test.ts
npm run typecheck --workspace=@context-reader/server
```

Expected: all focused tests PASS, TypeScript exits 0, and `npm why sharp` reports exactly `sharp@0.35.4`.

- [ ] **Step 8: Commit the boundary layer**

```bash
git add package.json package-lock.json packages/contracts server/package.json server/src/config server/src/core server/src/http server/src/modules/practice/routes.ts server/src/modules/translation/routes.ts server/src/plugins app/.env.example
git commit -m "feat: define article import backend contracts"
```

### Task 2: Add the import schema, migration, and exhaustive state machine

**Files:**
- Modify: `server/src/db/schema.ts`
- Generate: `server/drizzle/0001_article_imports.sql`
- Modify: `server/drizzle/meta/_journal.json`
- Generate: `server/drizzle/meta/0001_snapshot.json`
- Modify: `server/src/db/schema.integration.test.ts`
- Create: `server/src/modules/imports/state.ts`
- Test: `server/src/modules/imports/state.test.ts`
- Modify: `server/src/modules/jobs/types.ts`
- Modify: `server/src/modules/jobs/runner-registration.test.ts`

**Interfaces:**
- Consumes: `users`, `jobs`, `translationScope`, `translationStatus`, `AppDatabase`, and shared `ArticleImportStatus`.
- Produces: Drizzle exports `articleImports`, `importAssets`, `importedArticles`, `articleParagraphs`, `articleTranslations`, `computerUploadSessions`; job kinds `article_import` and `article_translation`; `ImportTransitionCause`; `canTransitionImport(from, to, cause): boolean`; and `assertImportTransition(from, to, cause): void`.

- [ ] **Step 1: Write failing schema and state tests**

Build the complete expected transition set, then test every status pair so an accidental extra edge fails:

```ts
import { describe, expect, it } from 'vitest';
import type { ArticleImportStatus } from '@context-reader/contracts';

import { canTransitionImport } from './state';

const statuses: ArticleImportStatus[] = [
  'awaiting_upload', 'queued', 'processing', 'retryable',
  'preview_ready', 'confirmed', 'failed', 'expired', 'cancelled',
];
const allowed = new Set([
  'awaiting_upload:queued:upload_complete',
  'awaiting_upload:expired:expired',
  'awaiting_upload:cancelled:cancelled',
  'queued:processing:worker_claimed',
  'queued:failed:permanent_failure',
  'queued:cancelled:cancelled',
  'processing:preview_ready:preview_created',
  'processing:queued:automatic_retry',
  'processing:retryable:extraction_retryable',
  'processing:failed:permanent_failure',
  'processing:cancelled:cancelled',
  'retryable:queued:user_retry',
  'retryable:expired:expired',
  'retryable:cancelled:cancelled',
  'preview_ready:confirmed:confirmed',
  'preview_ready:expired:expired',
  'preview_ready:cancelled:cancelled',
]);

describe('article import state machine', () => {
  it('permits exactly the approved edges and causes', () => {
    const causes = [
      'upload_complete', 'worker_claimed', 'automatic_retry',
      'extraction_retryable', 'preview_created', 'confirmed',
      'permanent_failure', 'cancelled', 'expired', 'user_retry',
    ] as const;
    for (const from of statuses) {
      for (const to of statuses) {
        for (const cause of causes) {
          expect(canTransitionImport(from, to, cause)).toBe(
            allowed.has(`${from}:${to}:${cause}`),
          );
        }
      }
    }
  });
});
```

Extend `schema.integration.test.ts` to create two users, an import, an asset, a computer session, an article with two paragraphs, and paragraph/full translation rows. Assert:

```ts
expect((await db.select().from(articleParagraphs)).map((row) => row.position))
  .toEqual([0, 1]);
await expect(db.insert(importAssets).values({
  articleImportId: importId,
  position: 0,
  mediaType: 'image/jpeg',
  byteSize: 1,
  sha256: 'b'.repeat(64),
  content: Buffer.from('different'),
})).rejects.toThrow();
await expect(db.insert(importedArticles).values({
  userId,
  sourceKind: 'paste',
  title: 'Duplicate',
  wordCount: 20,
  contentHash,
  similarityFingerprint: 1n,
  importedAt: new Date(),
})).rejects.toThrow();
```

Also insert jobs of both new kinds and assert `jobKinds` parses their returned values.

- [ ] **Step 2: Run the focused tests and verify missing tables and transitions**

Run:

```bash
npm test --workspace=@context-reader/server -- src/db/schema.integration.test.ts src/modules/imports/state.test.ts src/modules/jobs/runner-registration.test.ts
```

Expected: FAIL because the new tables, job kinds, and state module do not exist.

- [ ] **Step 3: Define enums and persistent article tables**

Import `AnyPgColumn`, `bigint as pgBigint`, and `customType` from `drizzle-orm/pg-core`, then add:

```ts
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const articleImportSourceKind = pgEnum('article_import_source_kind', [
  'url', 'paste', 'album', 'local_file', 'computer',
]);
export const articleImportStatus = pgEnum('article_import_status', [
  'awaiting_upload', 'queued', 'processing', 'retryable',
  'preview_ready', 'confirmed', 'failed', 'expired', 'cancelled',
]);
export const computerUploadStatus = pgEnum('computer_upload_status', [
  'awaiting_code', 'claimed', 'uploaded', 'expired',
]);
```

Change the existing job enum to:

```ts
export const jobKind = pgEnum('job_kind', [
  'practice_generation',
  'translation',
  'article_import',
  'article_translation',
]);
```

Add the long-lived article tables before the import table so its `articleId` foreign key has no declaration cycle:

```ts
export const importedArticles = pgTable(
  'imported_articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceKind: articleImportSourceKind('source_kind').notNull(),
    sourceUrl: text('source_url'),
    title: text('title').notNull(),
    wordCount: integer('word_count').notNull(),
    contentHash: text('content_hash').notNull(),
    similarityFingerprint: pgBigint('similarity_fingerprint', { mode: 'bigint' }).notNull(),
    previousVersionId: uuid('previous_version_id')
      .references((): AnyPgColumn => importedArticles.id),
    importedAt: utcTimestamp('imported_at').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('imported_article_user_hash_unique')
      .on(table.userId, table.contentHash),
    index('imported_article_user_created_idx')
      .on(table.userId, table.createdAt, table.id),
    check('imported_article_word_count_check', sql`${table.wordCount} between 20 and 5000`),
    check(
      'imported_article_source_url_check',
      sql`(${table.sourceKind} = 'url' and ${table.sourceUrl} is not null) or (${table.sourceKind} <> 'url' and ${table.sourceUrl} is null)`,
    ),
  ],
);

export const articleParagraphs = pgTable(
  'article_paragraphs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id').notNull()
      .references(() => importedArticles.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    plainText: text('plain_text').notNull(),
  },
  (table) => [
    unique('article_paragraph_position_unique').on(table.articleId, table.position),
    check('article_paragraph_position_check', sql`${table.position} >= 0`),
    check('article_paragraph_text_check', sql`length(${table.plainText}) > 0`),
  ],
);

export const articleTranslations = pgTable(
  'article_translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id').notNull()
      .references(() => importedArticles.id, { onDelete: 'cascade' }),
    scope: translationScope('scope').notNull(),
    paragraphId: uuid('paragraph_id').references(() => articleParagraphs.id),
    sourceHash: text('source_hash').notNull(),
    status: translationStatus('status').default('queued').notNull(),
    translatedTextZh: text('translated_text_zh'),
    failureCode: text('failure_code'),
    failureMessagePublic: text('failure_message_public'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    readyAt: utcTimestamp('ready_at'),
  },
  (table) => [
    unique('article_translation_cache_unique')
      .on(table.articleId, table.scope, table.paragraphId, table.sourceHash)
      .nullsNotDistinct(),
    check(
      'article_translation_scope_shape_check',
      sql`(${table.scope} = 'full' and ${table.paragraphId} is null) or (${table.scope} = 'paragraph' and ${table.paragraphId} is not null)`,
    ),
    check(
      'article_translation_result_shape_check',
      sql`(
        ${table.status} in ('queued', 'generating') and
        ${table.translatedTextZh} is null and
        ${table.failureCode} is null and
        ${table.failureMessagePublic} is null and
        ${table.readyAt} is null
      ) or (
        ${table.status} = 'ready' and
        ${table.translatedTextZh} is not null and
        ${table.failureCode} is null and
        ${table.failureMessagePublic} is null and
        ${table.readyAt} is not null
      ) or (
        ${table.status} = 'failed' and
        ${table.translatedTextZh} is null and
        ${table.failureCode} is not null and
        ${table.failureMessagePublic} is not null and
        ${table.readyAt} is null
      )`,
    ),
  ],
);
```

- [ ] **Step 4: Define import drafts, temporary assets, and computer sessions**

Define the descriptor-only manifest stored with asset imports; it contains no filename or bytes and is required so `/process` can prove that every declared position arrived after an API restart:

```ts
export interface ImportAssetManifestEntry {
  position: number;
  mediaType: string;
  byteSize: number;
}
```

Add:

```ts
export const articleImports = pgTable(
  'article_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceKind: articleImportSourceKind('source_kind').notNull(),
    status: articleImportStatus('status').notNull(),
    sourceUrl: text('source_url'),
    assetManifestJson: jsonb('asset_manifest_json').$type<ImportAssetManifestEntry[]>(),
    previewTitle: text('preview_title'),
    previewText: text('preview_text'),
    wordCount: integer('word_count'),
    contentHash: text('content_hash'),
    similarityFingerprint: pgBigint('similarity_fingerprint', { mode: 'bigint' }),
    failureCode: text('failure_code'),
    failureMessagePublic: text('failure_message_public'),
    articleId: uuid('article_id').references(() => importedArticles.id),
    attemptCount: integer('attempt_count').default(0).notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
    processingStartedAt: utcTimestamp('processing_started_at'),
    previewReadyAt: utcTimestamp('preview_ready_at'),
    confirmedAt: utcTimestamp('confirmed_at'),
    expiresAt: utcTimestamp('expires_at').notNull(),
  },
  (table) => [
    index('article_import_user_created_idx').on(table.userId, table.createdAt, table.id),
    index('article_import_status_expiry_idx').on(table.status, table.expiresAt),
    index('article_import_user_hash_idx').on(table.userId, table.contentHash),
    check('article_import_attempt_count_check', sql`${table.attemptCount} >= 0`),
    check(
      'article_import_preview_shape_check',
      sql`(
        ${table.status} in ('preview_ready', 'confirmed') and
        ${table.previewTitle} is not null and
        ${table.previewText} is not null and
        ${table.wordCount} between 20 and 5000 and
        ${table.contentHash} is not null and
        ${table.similarityFingerprint} is not null and
        ${table.previewReadyAt} is not null
      ) or (
        ${table.status} not in ('preview_ready', 'confirmed') and
        ${table.previewTitle} is null and
        ${table.previewText} is null and
        ${table.wordCount} is null and
        ${table.contentHash} is null and
        ${table.similarityFingerprint} is null and
        ${table.previewReadyAt} is null
      )`,
    ),
    check(
      'article_import_failure_shape_check',
      sql`(
        ${table.status} in ('retryable', 'failed') and
        ${table.failureCode} is not null and
        ${table.failureMessagePublic} is not null
      ) or (
        ${table.status} not in ('retryable', 'failed') and
        ${table.failureCode} is null and
        ${table.failureMessagePublic} is null
      )`,
    ),
    check(
      'article_import_article_shape_check',
      sql`(${table.status} = 'confirmed' and ${table.articleId} is not null and ${table.confirmedAt} is not null) or (${table.status} <> 'confirmed' and ${table.articleId} is null and ${table.confirmedAt} is null)`,
    ),
    check(
      'article_import_source_url_check',
      sql`(${table.sourceKind} = 'url' and ${table.sourceUrl} is not null) or (${table.sourceKind} <> 'url' and ${table.sourceUrl} is null)`,
    ),
    check(
      'article_import_manifest_check',
      sql`case
        when ${table.sourceKind} = 'album' then
          ${table.assetManifestJson} is not null and
          jsonb_typeof(${table.assetManifestJson}) = 'array' and
          jsonb_array_length(${table.assetManifestJson}) between 1 and 10
        when ${table.sourceKind} = 'local_file' then
          ${table.assetManifestJson} is not null and
          jsonb_typeof(${table.assetManifestJson}) = 'array' and
          jsonb_array_length(${table.assetManifestJson}) = 1
        else ${table.assetManifestJson} is null
      end`,
    ),
  ],
);

export const importAssets = pgTable(
  'import_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleImportId: uuid('article_import_id').notNull()
      .references(() => articleImports.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    content: bytea('content').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('import_asset_position_unique').on(table.articleImportId, table.position),
    unique('import_asset_digest_unique').on(table.articleImportId, table.sha256),
    index('import_asset_created_idx').on(table.createdAt),
    check('import_asset_position_check', sql`${table.position} between 0 and 9`),
    check('import_asset_size_check', sql`${table.byteSize} between 1 and 10485760`),
    check('import_asset_digest_check', sql`length(${table.sha256}) = 64`),
  ],
);

export const computerUploadSessions = pgTable(
  'computer_upload_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    articleImportId: uuid('article_import_id').notNull().unique()
      .references(() => articleImports.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull().unique(),
    capabilityTokenHash: text('capability_token_hash').unique(),
    status: computerUploadStatus('status').default('awaiting_code').notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    claimedAt: utcTimestamp('claimed_at'),
    uploadedAt: utcTimestamp('uploaded_at'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('computer_upload_expiry_idx').on(table.status, table.expiresAt),
    check(
      'computer_upload_state_shape_check',
      sql`(
        ${table.status} = 'awaiting_code' and
        ${table.capabilityTokenHash} is null and
        ${table.claimedAt} is null and
        ${table.uploadedAt} is null
      ) or (
        ${table.status} = 'claimed' and
        ${table.capabilityTokenHash} is not null and
        ${table.claimedAt} is not null and
        ${table.uploadedAt} is null
      ) or (
        ${table.status} = 'uploaded' and
        ${table.capabilityTokenHash} is null and
        ${table.claimedAt} is not null and
        ${table.uploadedAt} is not null
      ) or (
        ${table.status} = 'expired' and
        ${table.capabilityTokenHash} is null and
        ${table.uploadedAt} is null
      )`,
    ),
  ],
);
```

- [ ] **Step 5: Implement the exact transition function and expand job types**

Create `state.ts`:

```ts
import type { ArticleImportStatus } from '@context-reader/contracts';

import { AppError } from '../../core/errors';

export type ImportTransitionCause =
  | 'upload_complete'
  | 'worker_claimed'
  | 'automatic_retry'
  | 'extraction_retryable'
  | 'preview_created'
  | 'confirmed'
  | 'permanent_failure'
  | 'cancelled'
  | 'expired'
  | 'user_retry';

const transitions = new Set<string>([
  'awaiting_upload:queued:upload_complete',
  'awaiting_upload:expired:expired',
  'awaiting_upload:cancelled:cancelled',
  'queued:processing:worker_claimed',
  'queued:failed:permanent_failure',
  'queued:cancelled:cancelled',
  'processing:preview_ready:preview_created',
  'processing:queued:automatic_retry',
  'processing:retryable:extraction_retryable',
  'processing:failed:permanent_failure',
  'processing:cancelled:cancelled',
  'retryable:queued:user_retry',
  'retryable:expired:expired',
  'retryable:cancelled:cancelled',
  'preview_ready:confirmed:confirmed',
  'preview_ready:expired:expired',
  'preview_ready:cancelled:cancelled',
]);

export function canTransitionImport(
  from: ArticleImportStatus,
  to: ArticleImportStatus,
  cause: ImportTransitionCause,
): boolean {
  return transitions.has(`${from}:${to}:${cause}`);
}

export function assertImportTransition(
  from: ArticleImportStatus,
  to: ArticleImportStatus,
  cause: ImportTransitionCause,
): void {
  if (!canTransitionImport(from, to, cause)) {
    throw new AppError('STATE_CONFLICT', '导入状态已变更', 409);
  }
}
```

Set `jobKinds` in `server/src/modules/jobs/types.ts` to the same four enum values. Extend `runner-registration.test.ts` so a complete record for all four passes and omission of either new kind throws its name.

- [ ] **Step 6: Generate and inspect the named migration**

Run:

```bash
npm run db:generate --workspace=@context-reader/server -- --name article_imports
rg -n "article_imports|import_assets|imported_articles|article_paragraphs|article_translations|computer_upload_sessions|article_import|article_translation" server/drizzle/0001_article_imports.sql
```

Expected: the named migration creates all six tables, adds both job enum values, creates every unique/check/index above, and contains no `DROP TABLE`, `TRUNCATE`, or `DROP SCHEMA` statement.

- [ ] **Step 7: Run schema, state, and full regression tests**

Run:

```bash
npm test --workspace=@context-reader/server -- src/db/schema.integration.test.ts src/modules/imports/state.test.ts src/modules/jobs/runner-registration.test.ts
npm test --workspace=@context-reader/server
npm run typecheck --workspace=@context-reader/server
```

Expected: all focused and existing server tests PASS; the generated-practice and practice-translation suites remain green.

- [ ] **Step 8: Commit persistence and state rules**

```bash
git add server/src/db server/drizzle server/src/modules/imports/state.ts server/src/modules/imports/state.test.ts server/src/modules/jobs
git commit -m "feat: persist article import state"
```

### Task 3: Deliver pasted text through preview and atomic confirmation

**Files:**
- Create: `server/src/modules/imports/content.ts`
- Test: `server/src/modules/imports/content.test.ts`
- Create: `server/src/modules/imports/repository.ts`
- Create: `server/src/modules/imports/serializer.ts`
- Create: `server/src/modules/imports/service.ts`
- Create: `server/src/modules/imports/routes.ts`
- Test: `server/src/modules/imports/imports.integration.test.ts`
- Modify: `server/src/modules/idempotency/service.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: Task 1 DTOs and HTTP helpers; Task 2 tables and transition policy; existing anonymous auth and idempotency primitives.
- Produces: `NormalizedImportContent`; `normalizeImportContent(input): NormalizedImportContent`; `hammingDistance64(left, right): number`; `isSimilarContent(left, right): boolean`; `lockOwnedImport`; `findDuplicateForUser`; `serializeArticleImport`; `createArticleImport`; `putPastedSource`; `getArticleImportForUser`; `updateImportPreview`; `confirmArticleImport`; `cancelArticleImport`; and the first six live import routes.

- [ ] **Step 1: Write failing deterministic content tests**

Use original prose containing at least 20 English tokens. Cover CRLF/NFKC normalization, repeated empty lines, curly apostrophes, title fallback, invalid controls, non-English text, 19/20/5,000/5,001-word boundaries, exact hash stability, signed 64-bit storage, and similarity thresholds:

```ts
const prose = [
  'Careful readers compare evidence before they accept a broad public claim.',
  'They preserve context, inspect uncertainty, and revise conclusions when facts change.',
].join('\r\n\r\n');

const normalized = normalizeImportContent({ title: '  A careful study  ', text: prose });
expect(normalized.title).toBe('A careful study');
expect(normalized.paragraphs).toHaveLength(2);
expect(normalized.text).toBe(normalized.paragraphs.join('\n\n'));
expect(normalized.wordCount).toBeGreaterThanOrEqual(20);
expect(normalized.contentHash).toMatch(/^[0-9a-f]{64}$/u);
expect(BigInt.asIntN(64, normalized.similarityFingerprint))
  .toBe(normalized.similarityFingerprint);

expect(() => normalizeImportContent({
  title: null,
  text: Array.from({ length: 5_001 }, () => 'evidence').join(' '),
})).toThrowError(expect.objectContaining({ code: 'IMPORT_CONTENT_INVALID' }));
expect(hammingDistance64(0n, 7n)).toBe(3);
expect(isSimilarContent(
  { fingerprint: 0n, wordCount: 100 },
  { fingerprint: 7n, wordCount: 125 },
)).toBe(true);
expect(isSimilarContent(
  { fingerprint: 0n, wordCount: 100 },
  { fingerprint: 15n, wordCount: 100 },
)).toBe(false);
```

- [ ] **Step 2: Write the failing paste lifecycle integration test**

The test must authenticate two users and exercise HTTP, not call only the service. Assert:

1. `POST /v1/imports` with `{ sourceKind: 'paste' }` returns `awaiting_upload` and one import row.
2. Concurrent replay with the same key returns the same ID; changed material with that key returns `IDEMPOTENCY_KEY_REUSED`.
3. `PUT /source-text` with exact `Content-Length`, `text/plain; charset=utf-8`, and 20+ English words returns `preview_ready` without a job or asset.
4. Too-short, non-English, malformed UTF-8, missing length, or 131,073-byte payloads return stable public errors and create no article.
5. Preview editing recomputes word count/hash/fingerprint and rejects client-supplied extra fields.
6. Another user receives `404` for read/edit/confirm/cancel.
7. Confirmation writes one article plus ordered paragraphs and changes the import in one transaction.
8. A forced paragraph insert failure rolls back the article and leaves `preview_ready`.
9. Exact duplicate confirmation reuses the first article; similar content without a decision returns `SIMILAR_ARTICLE_REQUIRES_DECISION`; both explicit decisions behave as designed.
10. No practice, target, vocabulary, quota-ledger, or assistance row is created.

Use these request shapes in the test:

```ts
const created = await app.inject({
  method: 'POST',
  url: '/v1/imports',
  headers: {
    authorization: `Bearer ${ownerToken}`,
    'idempotency-key': 'paste-create-000001',
  },
  payload: { sourceKind: 'paste' },
});
const importId = ArticleImportDtoSchema.parse(created.json()).id;

const source = Buffer.from(SYNTHETIC_PROSE, 'utf8');
const preview = await app.inject({
  method: 'PUT',
  url: `/v1/imports/${importId}/source-text`,
  headers: {
    authorization: `Bearer ${ownerToken}`,
    'idempotency-key': 'paste-source-000001',
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(source.byteLength),
  },
  payload: source,
});
expect(ArticleImportDtoSchema.parse(preview.json()).status).toBe('preview_ready');

const confirmed = await app.inject({
  method: 'POST',
  url: `/v1/imports/${importId}/confirm`,
  headers: {
    authorization: `Bearer ${ownerToken}`,
    'idempotency-key': 'paste-confirm-0001',
  },
  payload: {},
});
expect(ArticleImportDtoSchema.parse(confirmed.json())).toMatchObject({
  status: 'confirmed',
  preview: null,
});
```

- [ ] **Step 3: Run focused tests and verify the new module failures**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/imports/content.test.ts src/modules/imports/imports.integration.test.ts
```

Expected: FAIL because common validation and import lifecycle services do not exist.

- [ ] **Step 4: Implement normalization, validation, hashing, and SimHash**

Create `content.ts` around this complete public boundary and deterministic algorithm:

```ts
import { createHash } from 'node:crypto';
import { franc } from 'franc-min';

import { AppError } from '../../core/errors';

const ENGLISH_WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/gu;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const LETTER = /\p{L}/gu;
const LATIN_LETTER = /\p{Script=Latin}/gu;

export interface NormalizedImportContent {
  title: string;
  text: string;
  paragraphs: string[];
  wordCount: number;
  contentHash: string;
  similarityFingerprint: bigint;
}

export interface SimilarityIdentity {
  fingerprint: bigint;
  wordCount: number;
}

export function countEnglishWords(value: string): number {
  return value.match(ENGLISH_WORD)?.length ?? 0;
}

export function normalizeImportContent(input: {
  title: string | null;
  text: string;
}): NormalizedImportContent {
  const canonical = input.text.normalize('NFKC').replace(/\r\n?/gu, '\n');
  const invalidCount = (canonical.match(DISALLOWED_CONTROL)?.length ?? 0)
    + (canonical.match(/\ufffd/gu)?.length ?? 0);
  const characterCount = Math.max(1, Array.from(canonical).length);
  if (invalidCount / characterCount >= 0.02) {
    throw invalidContent('文本包含过多无效字符');
  }

  const withoutControls = canonical.replace(DISALLOWED_CONTROL, '');
  const paragraphs = withoutControls
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph
      .split('\n')
      .map((line) => line.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .join(' ')
      .trim())
    .filter(Boolean);
  if (paragraphs.length === 0) throw invalidContent('未找到可导入的正文');

  const text = paragraphs.join('\n\n');
  const wordCount = countEnglishWords(text);
  if (wordCount < 20) throw invalidContent('英文正文至少需要 20 个词');
  if (wordCount > 5_000) throw invalidContent('英文正文不能超过 5,000 词');
  assertEnglish(text);

  const proposedTitle = normalizeTitle(input.title);
  const fallbackTitle = Array.from(paragraphs[0]!).slice(0, 160).join('').trim();
  const title = proposedTitle ?? (fallbackTitle || '导入文章');
  const contentHash = createHash('sha256').update(text, 'utf8').digest('hex');
  const similarityFingerprint = simHash64(text);
  return { title, text, paragraphs, wordCount, contentHash, similarityFingerprint };
}

export function hammingDistance64(left: bigint, right: bigint): number {
  let difference = BigInt.asUintN(64, left) ^ BigInt.asUintN(64, right);
  let count = 0;
  while (difference !== 0n) {
    difference &= difference - 1n;
    count += 1;
  }
  return count;
}

export function isSimilarContent(
  left: SimilarityIdentity,
  right: SimilarityIdentity,
): boolean {
  const ratio = left.wordCount / right.wordCount;
  return ratio >= 0.8 && ratio <= 1.25
    && hammingDistance64(left.fingerprint, right.fingerprint) <= 3;
}

function normalizeTitle(value: string | null): string | null {
  if (value === null) return null;
  const title = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return title.length > 0 && Array.from(title).length <= 160 ? title : null;
}

function assertEnglish(text: string): void {
  if (Array.from(text).length >= 100) {
    if (franc(text, { minLength: 20 }) !== 'eng') {
      throw new AppError('IMPORT_NOT_ENGLISH', '只能导入英文文章', 422);
    }
    return;
  }
  const letters = text.match(LETTER) ?? [];
  const latin = text.match(LATIN_LETTER) ?? [];
  if (letters.length === 0 || latin.length / letters.length < 0.8) {
    throw new AppError('IMPORT_NOT_ENGLISH', '只能导入英文文章', 422);
  }
}

function simHash64(text: string): bigint {
  const words = (text.toLocaleLowerCase('en-US').match(ENGLISH_WORD) ?? []);
  const shingles = words.length < 3
    ? [words.join(' ')]
    : Array.from({ length: words.length - 2 }, (_, index) =>
        words.slice(index, index + 3).join(' '));
  const weights = Array.from({ length: 64 }, () => 0);
  for (const shingle of shingles) {
    const digest = createHash('sha256').update(shingle, 'utf8').digest();
    const value = digest.readBigUInt64BE(0);
    for (let bit = 0; bit < 64; bit += 1) {
      weights[bit] += (value & (1n << BigInt(bit))) === 0n ? -1 : 1;
    }
  }
  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if (weights[bit]! >= 0) fingerprint |= 1n << BigInt(bit);
  }
  return BigInt.asIntN(64, fingerprint);
}

function invalidContent(message: string): AppError {
  return new AppError('IMPORT_CONTENT_INVALID', message, 422);
}
```

- [ ] **Step 5: Expand idempotency operations and implement locked repository helpers**

Set the union and resource map to include:

```ts
export type IdempotencyOperation =
  | 'create_practice'
  | 'request_translation'
  | 'record_assistance'
  | 'submit_answer'
  | 'create_article_import'
  | 'upload_import_text'
  | 'start_article_import'
  | 'edit_import_preview'
  | 'confirm_article_import'
  | 'retry_article_import'
  | 'cancel_article_import'
  | 'request_article_translation'
  | 'create_computer_upload_session';
```

Map import operations to `article_import`, article translation to `article_translation`, and computer creation to `computer_upload_session`.

In `repository.ts`, expose these exact signatures:

```ts
export type ArticleImportRow = typeof articleImports.$inferSelect;

export async function lockOwnedImport(
  tx: AppTransaction,
  userId: string,
  importId: string,
): Promise<ArticleImportRow>;

export async function findOwnedImport(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  importId: string,
): Promise<ArticleImportRow>;

export async function findDuplicateForUser(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  identity: { contentHash: string; fingerprint: bigint; wordCount: number },
): Promise<
  | { kind: 'none' }
  | { kind: 'exact'; article: { id: string; title: string; wordCount: number } }
  | { kind: 'similar'; article: { id: string; title: string; wordCount: number; hammingDistance: number } }
>;
```

`lockOwnedImport` selects `WHERE id = importId AND user_id = userId FOR UPDATE` and returns `NOT_FOUND` when absent. `findDuplicateForUser` checks exact hash first, then selects only that user's articles within the inclusive word-count ratio bounds, limits to the 500 newest candidates, computes Hamming distance in application code, and returns the lowest distance/newest match at distance at most three. It must never query or return another user's candidate.

- [ ] **Step 6: Implement paste lifecycle services and serializer**

Use these exact public service signatures:

```ts
export function createArticleImport(
  db: AppDatabase,
  input: {
    userId: string;
    idempotencyKey: string;
    request: CreateArticleImportRequest;
    draftTtlMs: number;
    jobDeadlineMs: number;
  },
): Promise<ArticleImportDto>;

export function putPastedSource(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    content: Buffer;
  },
): Promise<ArticleImportDto>;

export function getArticleImportForUser(
  db: AppDatabase,
  input: { userId: string; importId: string },
): Promise<ArticleImportDto>;

export function updateImportPreview(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    request: UpdateImportPreviewRequest;
  },
): Promise<ArticleImportDto>;

export function confirmArticleImport(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    request: ConfirmArticleImportRequest;
  },
): Promise<ArticleImportDto>;

export function cancelArticleImport(
  db: AppDatabase,
  input: { userId: string; importId: string; idempotencyKey: string },
): Promise<ArticleImportDto>;
```

`createArticleImport` stores URL imports as `queued` plus one `article_import` job, paste/album/local imports as `awaiting_upload`, and the validated asset descriptor array as `assetManifestJson`. It rejects URL protocols other than HTTP(S) and embedded credentials before inserting. Each transaction begins/finishes `create_article_import`, and an idempotent replay serializes the same owned import.

`putPastedSource` decodes with `new TextDecoder('utf-8', { fatal: true })`, maps decode failure to `IMPORT_CONTENT_INVALID`, locks the import, requires `paste + awaiting_upload`, calls `normalizeImportContent`, and updates all preview fields plus `previewReadyAt` and `updatedAt` in one transaction. It never inserts a job or `import_assets` row.

`updateImportPreview` requires `preview_ready`, reruns the same deterministic pipeline, and ignores no client fields because the route has already used the strict schema.

`confirmArticleImport` acquires `pg_advisory_xact_lock(hashtext(userId + ':' + contentHash))`, rechecks duplicates, and follows this exact decision table:

| Match | Decision | Result |
| --- | --- | --- |
| exact | absent/either value | link existing exact article |
| similar | absent | throw `SIMILAR_ARTICLE_REQUIRES_DECISION` 409 |
| similar | `open_existing` | link similar article |
| similar | `save_new_version` | create article with `previousVersionId` |
| none | absent | create article with no previous version |
| none | either value | throw `VALIDATION_ERROR` 400 |

For a new article, insert `imported_articles` and all normalized paragraphs, then update the import to `confirmed` with `articleId` and `confirmedAt`. For a reused article, only link it. In both cases, delete remaining assets inside the same transaction. A unique-hash race reloads the exact owner article and links it; no partial article or paragraph may survive rollback.

`cancelArticleImport` accepts only awaiting/queued/processing/retryable/preview states, applies the transition cause, clears every preview/failure field required by database checks, deletes assets, and returns `cancelled`. Confirmed and terminal resources return `STATE_CONFLICT`.

`serializeArticleImport(row, duplicate)` returns `pollAfterMs: 1500` only for awaiting/queued/processing; a preview only for `preview_ready`; an article ID only for `confirmed`; a retryable failure only for `retryable`; and a nonretryable failure only for `failed`.

- [ ] **Step 7: Register authenticated lifecycle routes with scoped body limits**

Inside the encapsulated `importsRoutes` plugin, replace only the inherited `text/plain` parser and add a catch-all stream parser:

```ts
app.removeContentTypeParser('text/plain');
app.addContentTypeParser('text/plain', (_request, payload, done) => {
  done(null, payload);
});
app.addContentTypeParser('*', (_request, payload, done) => {
  done(null, payload);
});
```

Register these routes with `requireAuth(options.db)`:

```text
POST  /v1/imports
PUT   /v1/imports/:id/source-text
GET   /v1/imports/:id
PATCH /v1/imports/:id/preview
POST  /v1/imports/:id/confirm
POST  /v1/imports/:id/cancel
```

The source-text handler requires MIME essence `text/plain`, parses a nonnegative integer `Content-Length`, calls `readBoundedStream(request.body as Readable, { contentLength, maxBytes: config.IMPORT_MAX_TEXT_BYTES })`, and passes only its `content` to the service. Give the preview PATCH route `{ bodyLimit: 128 * 1024 }`; every other JSON route keeps the 32 KiB global limit. Return `201` for a new import, `200` for read/edit/confirm/cancel, and validate every outgoing body with `ArticleImportDtoSchema`.

Register `importsRoutes` in `buildApp` after auth and before unrelated business routes.

- [ ] **Step 8: Run the paste tracer bullet and all existing regressions**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/imports/content.test.ts src/modules/imports/imports.integration.test.ts
npm test --workspace=@context-reader/server
npm run typecheck --workspace=@context-reader/server
npm run lint --workspace=@context-reader/server
```

Expected: pasted text reaches a confirmed private article, all focused assertions PASS, and all existing practice/translation/quota/evidence tests remain green.

- [ ] **Step 9: Commit the first complete import vertical slice**

```bash
git add server/src/modules/imports server/src/modules/idempotency server/src/app.ts
git commit -m "feat: import pasted articles"
```

### Task 4: Read private articles and translate them through a separate cache

**Files:**
- Create: `server/src/modules/articles/service.ts`
- Create: `server/src/modules/articles/routes.ts`
- Test: `server/src/modules/articles/articles.integration.test.ts`
- Create: `server/src/modules/translation/validation.ts`
- Test: `server/src/modules/translation/validation.test.ts`
- Modify: `server/src/modules/translation/handler.ts`
- Modify: `server/src/modules/translation/handler.test.ts`
- Modify: `server/src/modules/translation/service.ts`
- Create: `server/src/modules/article-translation/service.ts`
- Create: `server/src/modules/article-translation/handler.ts`
- Create: `server/src/modules/article-translation/routes.ts`
- Test: `server/src/modules/article-translation/article-translation.integration.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: confirmed `importedArticles`/`articleParagraphs`, `articleTranslations`, Task 1 article DTOs, `AiProvider.translate`/`moderate`, idempotency, and the lease queue.
- Produces: `getArticleForUser`; `/v1/articles/:id`; `validateTranslationText`; `assertTranslationModerationAccepted`; `createTranslationSourceHash`; `requestArticleTranslation`; `getArticleTranslationForUser`; `handleArticleTranslation`; `failArticleTranslation`; and article-translation job registration.

- [ ] **Step 1: Write failing owner-only article and translation integration tests**

Create one confirmed article for an owner and a different article for another user. Verify ordered read shape and 404 isolation:

```ts
const response = await app.inject({
  method: 'GET',
  url: `/v1/articles/${ownerArticle.id}`,
  headers: { authorization: `Bearer ${ownerToken}` },
});
const article = ImportedArticleDtoSchema.parse(response.json());
expect(article.paragraphs.map((paragraph) => paragraph.position)).toEqual([0, 1]);
expect(article.paragraphs.map((paragraph) => paragraph.text)).toEqual([
  FIRST_PARAGRAPH,
  SECOND_PARAGRAPH,
]);

const hidden = await app.inject({
  method: 'GET',
  url: `/v1/articles/${ownerArticle.id}`,
  headers: { authorization: `Bearer ${otherToken}` },
});
expect(hidden.statusCode).toBe(404);
```

For translation, concurrently request the same paragraph with two idempotency keys and assert one `article_translations` row plus one `article_translation` job. Request full translation and assert a distinct cache row. Claim both jobs, run the fake-provider handler, mark jobs succeeded, and assert ready Chinese output. Also prove:

- foreign article, paragraph, and translation IDs return `NOT_FOUND`;
- a paragraph must belong to the selected article;
- one idempotency key with a changed scope returns `IDEMPOTENCY_KEY_REUSED`;
- a failed cached translation resets to queued with a new job only under a new key;
- lease loss prevents ready and failure writes;
- article work creates no row in the existing `translations` table;
- existing practice translation tests remain green.

Use the public route once for each scope:

```ts
const initial = await app.inject({
  method: 'POST',
  url: `/v1/articles/${articleId}/translations`,
  headers: {
    authorization: `Bearer ${ownerToken}`,
    'idempotency-key': 'article-translation-0001',
  },
  payload: { scope: 'paragraph', paragraphId },
});
expect(initial.statusCode).toBe(202);
expect(ArticleTranslationDtoSchema.parse(initial.json())).toMatchObject({
  status: 'queued',
  translatedTextZh: null,
  pollAfterMs: 1_500,
  failure: null,
});
```

- [ ] **Step 2: Run tests and verify missing article modules**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/articles src/modules/article-translation src/modules/translation
```

Expected: FAIL because article reads, the independent cache, and shared validation helpers are absent.

- [ ] **Step 3: Extract the proven pure translation helpers without changing practice behavior**

Create `server/src/modules/translation/validation.ts`:

```ts
import { createHash } from 'node:crypto';

import { AppError } from '../../core/errors';
import type { ModerationResult } from '../../infrastructure/ai/types';

export function validateTranslationText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !/\p{Script=Han}/u.test(trimmed)) {
    throw new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
  }
  return trimmed;
}

export function assertTranslationModerationAccepted(
  result: ModerationResult,
): void {
  if (result.riskLevel !== 'low' || result.flagged) {
    throw new AppError(
      'AI_CONTENT_REJECTED',
      '翻译结果未通过安全检查',
      502,
      true,
    );
  }
}

export function createTranslationSourceHash(
  resourceId: string,
  scope: 'paragraph' | 'full',
  paragraphId: string | null,
  sourceText: string,
): string {
  return createHash('sha256')
    .update(`${resourceId}\u0000${scope}\u0000${paragraphId ?? ''}\u0000${sourceText}`, 'utf8')
    .digest('hex');
}
```

Import these functions from both existing translation files, remove their private copies, and re-export `validateTranslationText` from the existing handler so its current imports remain source-compatible. Update the existing source-hash call to pass practice ID, scope, nullable paragraph ID, and exact source text. Run the existing translation unit and integration tests immediately; their database rows and HTTP DTOs must not change.

- [ ] **Step 4: Implement owner-only ordered article reads**

Create `articles/service.ts`:

```ts
import { ImportedArticleDtoSchema, type ImportedArticleDto } from '@context-reader/contracts';
import { and, asc, eq } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { articleParagraphs, importedArticles } from '../../db/schema';

export async function getArticleForUser(
  db: AppDatabase,
  input: { userId: string; articleId: string },
): Promise<ImportedArticleDto> {
  const [article] = await db.select().from(importedArticles).where(and(
    eq(importedArticles.id, input.articleId),
    eq(importedArticles.userId, input.userId),
  )).limit(1);
  if (!article) throw new AppError('NOT_FOUND', '文章不存在', 404);

  const paragraphs = await db.select().from(articleParagraphs)
    .where(eq(articleParagraphs.articleId, article.id))
    .orderBy(asc(articleParagraphs.position));
  if (paragraphs.length === 0) {
    throw new AppError('INTERNAL_ERROR', '文章正文暂时无法读取', 500, true);
  }
  return ImportedArticleDtoSchema.parse({
    id: article.id,
    sourceKind: article.sourceKind,
    sourceUrl: article.sourceUrl,
    title: article.title,
    wordCount: article.wordCount,
    importedAt: article.importedAt.toISOString(),
    paragraphs: paragraphs.map((paragraph) => ({
      id: paragraph.id,
      position: paragraph.position,
      text: paragraph.plainText,
    })),
  });
}
```

`articles/routes.ts` authenticates, parses `:id` with `parseUuidParam`, calls this service, and returns `ImportedArticleDtoSchema.parse(article)` from `GET /v1/articles/:id`.

- [ ] **Step 5: Implement the article translation service and cache**

Use these exact boundaries:

```ts
export interface RequestArticleTranslationInput {
  userId: string;
  articleId: string;
  request: TranslationRequest;
  idempotencyKey: string;
  deadlineMs: number;
}

export function requestArticleTranslation(
  db: AppDatabase,
  input: RequestArticleTranslationInput,
): Promise<ArticleTranslationDto>;

export function getArticleTranslationForUser(
  db: AppDatabase,
  input: { userId: string; translationId: string },
): Promise<ArticleTranslationDto>;
```

Inside one transaction, `requestArticleTranslation` must:

1. begin `request_article_translation` using `{ articleId, ...request }`;
2. load the owner article and either one owned paragraph or all paragraphs ordered by position;
3. compute `createTranslationSourceHash(articleId, scope, paragraphId, sourceText)`;
4. take an advisory lock on that hash and load the cache identity with `NULLS NOT DISTINCT` semantics;
5. insert one queued row and one `article_translation` job when absent;
6. reset a failed cache row only after proving it has no queued/running job;
7. finish idempotency and serialize only ready text or a safe terminal failure.

Create jobs with `maxAttempts: 3`, `deadlineAt: new Date(Date.now() + deadlineMs)`, and no practice/quota side effect. Serialize queued/generating with `pollAfterMs: 1500`; ready with text; failed with the row's public code/message and `retryable: true`.

- [ ] **Step 6: Implement the lease-owned article translation handler**

Expose:

```ts
export interface ArticleTranslationHandlerDependencies {
  db: AppDatabase;
  provider: AiProvider;
}

export function handleArticleTranslation(
  dependencies: ArticleTranslationHandlerDependencies,
  job: ClaimedJob,
  context: { signal: AbortSignal },
): Promise<void>;

export function failArticleTranslation(
  dependencies: Pick<ArticleTranslationHandlerDependencies, 'db'>,
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
): Promise<void>;
```

The success handler loads source text from `article_paragraphs`, moves queued to generating under an active `article_translation` lease, calls `provider.translate`, validates Han text, moderates it, and persists ready output only after reacquiring `FOR UPDATE` locks on both the active job lease and translation row. `failArticleTranslation` uses the same lease guard and writes:

```ts
{
  status: 'failed',
  translatedTextZh: null,
  failureCode: error.code,
  failureMessagePublic: '翻译暂时无法完成',
  readyAt: null,
}
```

Neither handler may touch the existing `translations`, `practice_sessions`, assistance, or quota tables.

- [ ] **Step 7: Register routes and only the now-runnable article translation kind**

Add authenticated routes:

```text
GET  /v1/articles/:id
POST /v1/articles/:id/translations
GET  /v1/article-translations/:id
```

The POST parses `TranslationRequestSchema`, requires an idempotency key, returns 200 for a ready cache hit and 202 otherwise. The GET returns the strict article-translation DTO.

Register `articlesRoutes` and `articleTranslationRoutes` in `buildApp`. In `server/src/index.ts`, add dependencies and this registration while leaving `article_import` disabled until Task 5 supplies its handler:

```ts
const enabledKinds = [
  'practice_generation',
  'translation',
  'article_translation',
] as const;

article_translation: {
  handle: (job, context) =>
    handleArticleTranslation(articleTranslationDependencies, job, context),
  onPermanentFailure: (job, error, context) =>
    failArticleTranslation(articleTranslationDependencies, job, error, context),
},
```

- [ ] **Step 8: Run focused and existing translation gates**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/articles src/modules/article-translation src/modules/translation
npm test --workspace=@context-reader/server -- src/modules/practice
npm run typecheck --workspace=@context-reader/server
npm run lint --workspace=@context-reader/server
```

Expected: all tests PASS; article translations cache independently; practice translation DTOs and behavior remain unchanged.

- [ ] **Step 9: Commit article reads and translation**

```bash
git add server/src/modules/articles server/src/modules/article-translation server/src/modules/translation server/src/app.ts server/src/index.ts
git commit -m "feat: read and translate imported articles"
```

### Task 5: Fetch public URLs safely and process them through the lease worker

**Files:**
- Create: `server/src/modules/imports/extractors/types.ts`
- Create: `server/src/modules/imports/extractors/html.ts`
- Test: `server/src/modules/imports/extractors/html.test.ts`
- Create: `server/src/modules/imports/extractors/url-policy.ts`
- Test: `server/src/modules/imports/extractors/url-policy.test.ts`
- Create: `server/src/modules/imports/extractors/safe-fetch.ts`
- Test: `server/src/modules/imports/extractors/safe-fetch.test.ts`
- Create: `server/src/modules/imports/handler.ts`
- Test: `server/src/modules/imports/handler.integration.test.ts`
- Modify: `server/src/modules/imports/service.ts`
- Modify: `server/src/modules/imports/routes.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: URL imports queued by Task 3, common validation, import transitions, active job leases, Undici, LinkeDOM, and Mozilla Readability.
- Produces: `ExtractedArticle`; `resolveSafeHttpTarget`; `safeFetchHtml`; `extractReadableHtml`; `handleArticleImport`; `failArticleImport`; `retryArticleImport`; a live retry endpoint; and the complete four-kind startup registry.

- [ ] **Step 1: Write failing URL policy and fetch tests**

Use a table-driven policy test for literals and injected DNS answers:

```ts
const blocked = [
  'http://127.0.0.1/',
  'http://2130706433/',
  'http://0x7f000001/',
  'http://10.0.0.1/',
  'http://172.16.0.1/',
  'http://192.168.0.1/',
  'http://100.64.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://224.0.0.1/',
  'http://[::1]/',
  'http://[fc00::1]/',
  'http://[fe80::1]/',
  'http://[::ffff:127.0.0.1]/',
  'ftp://example.com/file',
  'https://user:password@example.com/',
];
for (const value of blocked) {
  await expect(resolveSafeHttpTarget(value, resolver)).rejects.toMatchObject({
    code: 'IMPORT_FETCH_BLOCKED',
  });
}
```

Make the resolver return both `93.184.216.34` and `127.0.0.1`; the whole host must be rejected. Return one public IPv4 or IPv6 address and assert the result contains that exact pinned address and family.

For `safeFetchHtml`, inject a `requestPage(target, signal)` fake and assert:

- every redirect causes a fresh resolver call and passes the resolved address to `requestPage`;
- a same-host second lookup that changes from public to private is blocked before the second request;
- a sixth redirect fails;
- missing/invalid `Location`, non-2xx status, wrong MIME, 5,242,881 bytes, and a 15,001 ms response fail safely;
- `text/html; charset=utf-8` and `application/xhtml+xml` pass;
- request headers contain no authorization, cookie, referrer, forwarded host, or user-supplied value;
- an outer abort stops the read and becomes an `AbortError`, not a public retry response.

- [ ] **Step 2: Write failing HTML and job integration tests**

`html.test.ts` must feed navigation, script, style, comments, and a main article into the parser. Assert no script executes, no navigation/sidebar text appears, title/text are returned, and only static text leaves the adapter.

The job integration test must create a queued URL import and job, claim it, inject a public HTML page, run the handler, and assert `preview_ready`, normalized preview fields, no source bytes, and a succeeded job. Add cases for:

- concurrent workers cannot both persist;
- a lost lease prevents preview/failure writes;
- retryable fetch failure on attempts one and two moves `processing -> queued` before rescheduling;
- exhausted transient failure produces `retryable` and exposes the retry route;
- unsafe URL, unsupported MIME, empty extraction, and deadline produce terminal `failed`;
- terminal failure leaves no article and no asset.

- [ ] **Step 3: Run focused tests and verify missing extractors/handler**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/imports/extractors src/modules/imports/handler.integration.test.ts
```

Expected: FAIL because URL policy, fetch, HTML extraction, and import job handling do not exist.

- [ ] **Step 4: Define the extraction boundary and static HTML adapter**

Create `extractors/types.ts`:

```ts
export interface ExtractedArticle {
  title: string | null;
  text: string;
}

export interface ImportAssetInput {
  position: number;
  mediaType: string;
  content: Buffer;
}
```

Create `html.ts`:

```ts
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { AppError } from '../../../core/errors';
import type { ExtractedArticle } from './types';

export function extractReadableHtml(
  html: string,
  sourceUrl: string,
): ExtractedArticle {
  const { document } = parseHTML(html);
  for (const element of document.querySelectorAll(
    'script,style,noscript,template,iframe,object,embed',
  )) {
    element.remove();
  }
  const base = document.createElement('base');
  base.setAttribute('href', sourceUrl);
  document.head.prepend(base);
  const readableDocument = document.cloneNode(true) as unknown as
    ConstructorParameters<typeof Readability>[0];
  const parsed = new Readability(readableDocument, {
    charThreshold: 20,
    maxElemsToParse: 50_000,
    disableJSONLD: false,
  }).parse();
  const text = parsed?.textContent?.trim() ?? '';
  if (!text) {
    throw new AppError('IMPORT_PARSE_FAILED', '未能从网页中提取正文，请粘贴正文', 422);
  }
  return { title: parsed?.title?.trim() || null, text };
}
```

If LinkeDOM's document type is not structurally accepted by Readability's DOM type, contain the one necessary cast inside this adapter; do not expose DOM values elsewhere and do not enable scripts or subresource loading.

- [ ] **Step 5: Implement URL parsing, DNS validation, and address pinning**

Create `url-policy.ts` with this public contract:

```ts
import { lookup as nodeLookup } from 'node:dns/promises';
import * as ipaddr from 'ipaddr.js';

import { AppError } from '../../../core/errors';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type ResolveHost = (hostname: string) => Promise<readonly ResolvedAddress[]>;
export interface SafeHttpTarget extends ResolvedAddress {
  url: URL;
}

export const resolveWithNode: ResolveHost = async (hostname) => {
  const rows = await nodeLookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => ({ address: row.address, family: row.family as 4 | 6 }));
};

export async function resolveSafeHttpTarget(
  rawUrl: string | URL,
  resolveHost: ResolveHost = resolveWithNode,
): Promise<SafeHttpTarget> {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
  } catch {
    throw blocked();
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' || url.password !== '' || url.hostname === ''
  ) {
    throw blocked();
  }
  url.hash = '';
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  let rows: readonly ResolvedAddress[];
  if (ipaddr.isValid(hostname)) {
    rows = [{
      address: hostname,
      family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6,
    }];
  } else {
    try {
      rows = await resolveHost(hostname);
    } catch {
      throw new AppError('IMPORT_FETCH_FAILED', '网页暂时无法读取', 503, true);
    }
  }
  if (rows.length === 0 || rows.some((row) => !isPublicUnicast(row.address))) {
    throw blocked();
  }
  return { url, ...rows[0]! };
}

function isPublicUnicast(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === 'unicast';
}

function blocked(): AppError {
  return new AppError('IMPORT_FETCH_BLOCKED', '该网络地址不允许导入', 422);
}
```

Keep the rule deliberately fail-closed: if any DNS answer is not public unicast, reject the hostname instead of selecting only its safe answer.

- [ ] **Step 6: Implement bounded manual redirects with one pinned dispatcher per hop**

Expose this injectable boundary from `safe-fetch.ts`:

```ts
export interface PageResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}
export type RequestPinnedPage = (
  target: SafeHttpTarget,
  signal: AbortSignal,
) => Promise<PageResponse>;

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  resolveHost?: ResolveHost;
  requestPage?: RequestPinnedPage;
  signal: AbortSignal;
}

export function safeFetchHtml(
  initialUrl: string,
  options: SafeFetchOptions,
): Promise<{ finalUrl: string; html: string }>;
```

The production `RequestPinnedPage` creates `new Agent({ connections: 1, connect: { lookup } })` for one target. Its lookup callback always returns the validated `target.address`/`target.family`; call Undici `request(target.url, { dispatcher, method: 'GET', maxRedirections: 0, headersTimeout, bodyTimeout, signal })`; send only fixed `accept`, `accept-encoding: identity`, and `user-agent: ContextReaderFetcher/1.0` headers; and return `close: () => agent.destroy()` with the response stream.

`safeFetchHtml` combines the caller signal with `AbortSignal.timeout(timeoutMs)`, resolves and pins every hop, accepts status 200–299 only, handles 301/302/303/307/308 manually, resolves `Location` with `new URL(location, current)`, and allows at most five hops. Normalize the MIME essence with `String(contentType).split(';', 1)[0]!.trim().toLowerCase()`. Read chunks while counting bytes and abort immediately above `maxBytes`; decode UTF-8 only after the bounded body finishes. Wrap each hop in `try/finally` and await `response.close()` after consuming success or abandoning a redirect/error body, so no dispatcher survives and no stream is closed before its consumer finishes. Map network/timeouts to retryable `IMPORT_FETCH_FAILED`, unsafe targets to `IMPORT_FETCH_BLOCKED`, wrong MIME to `IMPORT_UNSUPPORTED_TYPE`, and malformed/empty response to nonretryable `IMPORT_FETCH_FAILED`. Preserve an outer `AbortError` unchanged.

- [ ] **Step 7: Implement lease-safe URL import handling**

Expose:

```ts
export interface ArticleImportHandlerDependencies {
  db: AppDatabase;
  fetchMaxBytes: number;
  fetchTimeoutMs: number;
  fetchHtml?: typeof safeFetchHtml;
}

export function handleArticleImport(
  dependencies: ArticleImportHandlerDependencies,
  job: ClaimedJob,
  context: { signal: AbortSignal },
): Promise<void>;

export function failArticleImport(
  dependencies: Pick<ArticleImportHandlerDependencies, 'db'>,
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
): Promise<void>;
```

The handler must lock the active `article_import` job and owned import together, move queued to processing, increment `article_imports.attemptCount`, fetch/extract/normalize the URL, then reacquire the active lease and processing row before updating preview fields. The preview transaction deletes assets before committing `preview_ready`.

On a retryable error while `shouldRetry(job, now)` is true, reacquire the lease and move processing back to queued with cause `automatic_retry`, then rethrow so the generic runner reschedules. On the final automatic attempt, rethrow while processing; `failArticleImport` maps retryable fetch/parser/provider errors to `retryable`, maps deadlines to `IMPORT_DEADLINE_EXCEEDED`, maps every deterministic error to `failed`, writes only safe code/copy, and deletes assets for terminal `failed` but not `retryable`. Every state write includes a locked active lease; zero rows/expired lease throws `AbortError`.

- [ ] **Step 8: Add explicit retry and register every job kind**

Add:

```ts
export function retryArticleImport(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    jobDeadlineMs: number;
    assetTtlMs: number;
  },
): Promise<ArticleImportDto>;
```

Inside `retry_article_import`, lock the owner import, require `retryable`, reject if the import or retained asset TTL has expired, prove no active article-import job exists, clear public failure fields, move to queued with `user_retry`, and insert a fresh three-attempt job using the same import ID. Register `POST /v1/imports/:id/retry` and return 202.

In `server/src/index.ts`, set `enabledKinds = jobKinds` and make registrations compile-time complete:

```ts
const registrations = {
  practice_generation: practiceGenerationRegistration,
  translation: practiceTranslationRegistration,
  article_import: articleImportRegistration,
  article_translation: articleTranslationRegistration,
} satisfies Record<JobKind, JobRegistration>;
```

Construct the registrations inline from the existing handlers if named registration constants would duplicate dependency wiring. Startup must now fail typecheck/runtime registration validation when any enum kind lacks both functions.

- [ ] **Step 9: Run security and job regressions**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/imports/extractors src/modules/imports/handler.integration.test.ts src/modules/jobs
npm test --workspace=@context-reader/server -- src/modules/practice src/modules/translation
npm run typecheck --workspace=@context-reader/server
npm run lint --workspace=@context-reader/server
```

Expected: URL allow/deny and rebinding tests PASS, lease tests PASS, and all pre-existing worker behavior stays green.

- [ ] **Step 10: Commit URL importing**

```bash
git add server/src/modules/imports server/src/index.ts
git commit -m "feat: import public web articles safely"
```

### Task 6: Upload bounded assets and parse text, HTML, DOCX, and text PDFs

**Files:**
- Modify: `server/package.json`
- Modify: `package-lock.json`
- Create: `server/test/fixtures/import-documents.ts`
- Create: `server/src/modules/imports/extractors/document.ts`
- Test: `server/src/modules/imports/extractors/document.test.ts`
- Modify: `server/src/modules/imports/repository.ts`
- Modify: `server/src/modules/imports/service.ts`
- Modify: `server/src/modules/imports/routes.ts`
- Modify: `server/src/modules/imports/handler.ts`
- Modify: `server/src/modules/imports/handler.integration.test.ts`
- Modify: `server/src/modules/imports/imports.integration.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: asset manifests, `readBoundedStream`, common content validation, static HTML extraction, article-import jobs, and temporary `bytea` storage.
- Produces: `detectImportFile`; `extractDocumentAsset`; `getExpectedAssetUpload`; `uploadImportAsset`; `startArticleImport`; `PUT /v1/imports/:id/assets/:position`; `POST /v1/imports/:id/process`; and local-file extraction for TXT/Markdown/HTML/DOCX/PDF.

- [ ] **Step 1: Add deterministic in-memory document fixtures and failing parser tests**

Add test-only dependencies:

```json
{
  "devDependencies": {
    "fflate": "0.8.2",
    "pdf-lib": "1.17.1"
  }
}
```

In `server/test/fixtures/import-documents.ts`, export:

```ts
export function createDocxFixture(paragraphs: readonly string[]): Buffer;
export function createTextPdfFixture(paragraphs: readonly string[]): Promise<Buffer>;
export function createEmptyPdfFixture(): Promise<Buffer>;
export const SYNTHETIC_IMPORT_PARAGRAPHS: readonly [string, string];
```

`createDocxFixture` uses `fflate.zipSync` to create `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`; XML-escape every paragraph before placing it in `<w:p><w:r><w:t>...</w:t></w:r></w:p>`. `createTextPdfFixture` uses `PDFDocument.create()`, embeds `StandardFonts.Helvetica`, and draws each original synthetic paragraph on its own page/line. These helpers return buffers only in memory and never invoke a shell or accept filenames.

Write parser cases for:

```ts
expect(await extractDocumentAsset({
  position: 0,
  mediaType: 'text/plain',
  content: Buffer.from('\ufeff' + SYNTHETIC_IMPORT_PARAGRAPHS.join('\n\n'), 'utf8'),
})).toMatchObject({ title: null });

await expect(extractDocumentAsset({
  position: 0,
  mediaType: 'text/plain',
  content: Buffer.from([0xc3, 0x28]),
})).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED' });

await expect(extractDocumentAsset({
  position: 0,
  mediaType: 'image/jpeg',
  content: await createTextPdfFixture(SYNTHETIC_IMPORT_PARAGRAPHS),
})).rejects.toMatchObject({ code: 'IMPORT_UNSUPPORTED_TYPE' });
```

Also cover Markdown as UTF-8 text, static HTML, DOCX paragraph order, text PDF page order, empty/scanned PDF guidance, corrupt ZIP/PDF, accepted magic types, a mislabeled magic type, and generic octet-stream magic detection. Never pass a file extension or path to the detector.

- [ ] **Step 2: Write failing upload and process integration tests**

For an album and a local-file import, test:

- declared position, media type, and exact byte size are required;
- position outside the manifest fails before reading;
- the server digest is stored and never accepted from a client header/body;
- identical bytes at an occupied position replay successfully;
- different bytes at that position return `STATE_CONFLICT`;
- duplicate digest at another position violates the import digest unique rule;
- one asset above 10 MiB and aggregate above 30 MiB return `IMPORT_TOO_LARGE`;
- `process` fails while any declared position is absent;
- two concurrent `process` calls create one active job;
- upload/process/read by another user return 404;
- no API response contains `content`, SHA-256, or source bytes.

The successful raw request is:

```ts
const upload = await app.inject({
  method: 'PUT',
  url: `/v1/imports/${importId}/assets/0`,
  headers: {
    authorization: `Bearer ${ownerToken}`,
    'content-type': 'application/pdf',
    'content-length': String(pdf.byteLength),
  },
  payload: pdf,
});
expect(upload.statusCode).toBe(200);
expect(upload.body).not.toContain(pdf.toString('base64'));

const started = await app.inject({
  method: 'POST',
  url: `/v1/imports/${importId}/process`,
  headers: {
    authorization: `Bearer ${ownerToken}`,
    'idempotency-key': 'local-process-0001',
  },
  payload: {},
});
expect(ArticleImportDtoSchema.parse(started.json()).status).toBe('queued');
```

- [ ] **Step 3: Run the focused tests and verify missing upload/parser behavior**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/imports/extractors/document.test.ts src/modules/imports/imports.integration.test.ts src/modules/imports/handler.integration.test.ts
```

Expected: FAIL because document extraction and asset/process services are absent.

- [ ] **Step 4: Implement signature-first file detection**

Create this union and boundary in `document.ts`:

```ts
import { fileTypeFromBuffer } from 'file-type';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { AppError } from '../../../core/errors';
import { countEnglishWords } from '../content';
import { extractReadableHtml } from './html';
import type { ExtractedArticle, ImportAssetInput } from './types';

export type DetectedImportFile =
  | { kind: 'text'; mediaType: 'text/plain' | 'text/markdown' }
  | { kind: 'html'; mediaType: 'text/html' | 'application/xhtml+xml' }
  | { kind: 'pdf'; mediaType: 'application/pdf' }
  | { kind: 'docx'; mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/heic' | 'image/heif' };

export function detectImportFile(
  content: Buffer,
  declaredMediaType: string,
): Promise<DetectedImportFile>;

export function extractDocumentAsset(
  asset: ImportAssetInput,
): Promise<ExtractedArticle>;
```

Detection rules are exact:

1. call `fileTypeFromBuffer(content)` before interpreting declared media type;
2. if it detects PDF, DOCX, JPEG, PNG, WebP, GIF, HEIC, or HEIF, accept only the matching declared MIME or `application/octet-stream` (HEIC/HEIF are one compatible family);
3. if no magic matches, accept declared plain/Markdown/HTML/XHTML only after fatal UTF-8 decode and rejection of NUL bytes;
4. for an octet-stream without known magic, fatal-decode UTF-8, choose HTML only when the first 1,024 characters contain a doctype/html/body/article tag, otherwise choose plain text;
5. never consult an extension, original name, URL query, or multipart filename;
6. every other type throws nonretryable `IMPORT_UNSUPPORTED_TYPE`.

- [ ] **Step 5: Implement bounded document extraction**

Use this extraction body:

```ts
export async function extractDocumentAsset(
  asset: ImportAssetInput,
): Promise<ExtractedArticle> {
  const detected = await detectImportFile(asset.content, asset.mediaType);
  try {
    if (detected.kind === 'text') {
      const text = new TextDecoder('utf-8', { fatal: true })
        .decode(asset.content)
        .replace(/^\ufeff/u, '');
      return { title: null, text };
    }
    if (detected.kind === 'html') {
      const html = new TextDecoder('utf-8', { fatal: true }).decode(asset.content);
      return extractReadableHtml(html, 'https://local-file.invalid/');
    }
    if (detected.kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer: asset.content });
      return { title: null, text: result.value };
    }
    if (detected.kind === 'pdf') {
      const parser = new PDFParse({ data: new Uint8Array(asset.content) });
      try {
        const result = await parser.getText();
        if (countEnglishWords(result.text) < 20) {
          throw new AppError(
            'IMPORT_PARSE_FAILED',
            '该 PDF 没有可提取的英文正文，请将页面导出为图片后从相册导入',
            422,
          );
        }
        return { title: null, text: result.text };
      } finally {
        await parser.destroy();
      }
    }
    throw new AppError('IMPORT_UNSUPPORTED_TYPE', '该图片需要通过 OCR 导入', 422);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('IMPORT_PARSE_FAILED', '文件无法解析', 422);
  }
}
```

Mammoth receives only a buffer and `extractRawText`, so macros, embedded files, comments, and images are not executed or fetched. PDFParse receives bytes, never a URL, and is destroyed in `finally`.

- [ ] **Step 6: Implement owner-safe upload and atomic process services**

Expose:

```ts
export function getExpectedAssetUpload(
  db: AppDatabase,
  input: { userId: string; importId: string; position: number },
): Promise<{ mediaType: string; byteSize: number }>;

export function uploadImportAsset(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    position: number;
    mediaType: string;
    content: Buffer;
    byteSize: number;
    sha256: string;
    maxTotalBytes: number;
  },
): Promise<ArticleImportDto>;

export function startArticleImport(
  db: AppDatabase,
  input: {
    userId: string;
    importId: string;
    idempotencyKey: string;
    jobDeadlineMs: number;
    maxTotalBytes: number;
  },
): Promise<ArticleImportDto>;
```

`getExpectedAssetUpload` validates integer position, owner, `awaiting_upload`, and the immutable manifest entry. The route compares MIME essence and declared length, hands its stream to `readBoundedStream`, then calls `uploadImportAsset`.

`uploadImportAsset` locks the owner import, repeats all manifest checks, locks existing assets, treats the same position+digest+size as a replay, rejects different content at an occupied position, enforces sum of stored bytes plus new bytes at or below `maxTotalBytes`, and inserts one row. It returns import metadata only.

`startArticleImport` begins `start_article_import`, locks the owner import, requires every manifest position exactly once with matching media type and byte size, rechecks aggregate bytes, transitions awaiting to queued, inserts one three-attempt job with the configured deadline, finishes idempotency, and returns the queued DTO. Advisory idempotency locking plus the active-job unique index ensures concurrent process calls create one job.

- [ ] **Step 7: Register scoped streaming routes**

Inside the encapsulated imports plugin, remove the inherited `text/plain` parser and add stream-preserving parsers:

```ts
app.removeContentTypeParser('text/plain');
app.addContentTypeParser('text/plain', (_request, payload, done) => {
  done(null, payload);
});
app.addContentTypeParser('*', (_request, payload, done) => {
  done(null, payload);
});
```

Keep JSON's exact built-in parser in place. For source-text and raw asset routes, require one numeric `Content-Length`, use `request.body` as a Node `Readable`, and pass `request.raw` abort through an `AbortController`. The asset route has no idempotency record; the process route requires one. Map Fastify unsupported media type and body-limit errors to the import error contract without including the MIME string or filename.

- [ ] **Step 8: Dispatch non-image local assets in the import handler**

Extend handler dependencies with `extractDocument?: typeof extractDocumentAsset`. Load all import assets ordered by immutable position after moving to processing. For `local_file`, require exactly one asset and call the document adapter. Pass its output through `normalizeImportContent`, then use the same lease-safe preview transaction as URL import. If detection returns image, keep the import retryable with safe OCR guidance until Task 7 adds the image adapter; no client button is wired during this backend-only sequence.

- [ ] **Step 9: Run asset, parser, and full server gates**

Run:

```bash
npm install
npm test --workspace=@context-reader/server -- src/modules/imports/extractors/document.test.ts src/modules/imports/imports.integration.test.ts src/modules/imports/handler.integration.test.ts
npm test --workspace=@context-reader/server
npm run typecheck --workspace=@context-reader/server
npm run lint --workspace=@context-reader/server
```

Expected: all document formats and upload races PASS; no existing practice behavior regresses.

- [ ] **Step 10: Commit bounded document imports**

```bash
git add package-lock.json server/package.json server/test/fixtures server/src/modules/imports server/src/app.ts
git commit -m "feat: import bounded document files"
```

### Task 7: Normalize images and extract ordered text with EvoLink vision OCR

**Files:**
- Create: `server/src/types/heic-convert.d.ts`
- Create: `server/src/modules/imports/extractors/image.ts`
- Test: `server/src/modules/imports/extractors/image.test.ts`
- Create: `server/src/modules/imports/extractors/ocr.ts`
- Test: `server/src/modules/imports/extractors/ocr.test.ts`
- Modify: `server/src/infrastructure/ai/types.ts`
- Modify: `server/src/infrastructure/ai/prompts.ts`
- Modify: `server/src/infrastructure/ai/evolink-client.ts`
- Modify: `server/src/infrastructure/ai/evolink-client.test.ts`
- Modify: `server/src/infrastructure/ai/evolink-provider.ts`
- Modify: `server/src/infrastructure/ai/evolink-provider.test.ts`
- Modify: `server/src/infrastructure/ai/fake-provider.ts`
- Modify: `server/src/infrastructure/ai/fake-provider.test.ts`
- Modify: `server/src/modules/imports/handler.ts`
- Modify: `server/src/modules/imports/handler.integration.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: accepted image magic types, ordered assets, EvoLink Chat Completions, import worker lease checks, and common content validation.
- Produces: `OcrImage`; `AiProvider.extractArticleText`; `normalizeImageAsset`; `extractOrderedImageText`; image import support for album/local/computer sources; and dedicated vision model/timeout wiring.

- [ ] **Step 1: Write failing image-normalization tests**

Generate synthetic inputs in memory with Sharp; do not commit photos. Assert:

- a 3,000×1,500 JPEG becomes at most 2,048 pixels on the long edge;
- EXIF orientation is applied to output dimensions;
- EXIF/ICC metadata is absent from output;
- alpha PNG stays PNG and opaque input becomes JPEG quality 82;
- GIF and animated WebP use only frame zero;
- HEIC/HEIF calls an injected converter once, then uses the same Sharp pipeline;
- corrupt/decompression-bomb dimensions return nonretryable `IMPORT_PARSE_FAILED`;
- output media is only JPEG or PNG and output position equals immutable input position.

Use this expected shape:

```ts
const normalized = await normalizeImageAsset({
  position: 3,
  mediaType: 'image/jpeg',
  content: await sharp({
    create: { width: 3_000, height: 1_500, channels: 3, background: '#ffffff' },
  }).jpeg().toBuffer(),
});
expect(normalized.position).toBe(3);
expect(normalized.mediaType).toBe('image/jpeg');
const metadata = await sharp(Buffer.from(normalized.base64, 'base64')).metadata();
expect(Math.max(metadata.width!, metadata.height!)).toBe(2_048);
expect(metadata.exif).toBeUndefined();
```

- [ ] **Step 2: Write failing OCR batching and provider request tests**

Pass ten normalized images in shuffled array order. Assert the OCR adapter sorts positions, sends batches `[0,1,2,3]`, `[4,5,6,7]`, `[8,9]`, calls at most four images each time, and joins batch text in position order with blank lines. Duplicate, missing, or negative positions fail before a provider call. Use an abort signal between batches and assert no later batch runs.

In the EvoLink provider/client tests, assert the outgoing Chat Completions body contains:

```json
{
  "model": "deepseek-v4-flash-vision-exp",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "<OCR instruction and image position 0>" },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,dGVzdA==" } }
      ]
    }
  ],
  "stream": false,
  "response_format": { "type": "json_object" }
}
```

The assertion should match exact types/URL and pattern-match the instruction rather than snapshotting article text. Add blank, non-JSON, extra-field, missing-title, and missing-text response failures. Assert vision uses 120,000 ms while text requests retain 60,000 ms.

- [ ] **Step 3: Run focused tests and verify image/OCR APIs are absent**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/imports/extractors/image.test.ts src/modules/imports/extractors/ocr.test.ts src/infrastructure/ai
```

Expected: FAIL because image normalization and `extractArticleText` are not defined.

- [ ] **Step 4: Add the narrow HEIC declaration and normalize all image inputs**

Create `server/src/types/heic-convert.d.ts`:

```ts
declare module 'heic-convert' {
  export default function convert(options: {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }): Promise<Buffer>;
}
```

Create `image.ts` around this exact boundary:

```ts
import convertHeic from 'heic-convert';
import sharp from 'sharp';

import { AppError } from '../../../core/errors';
import type { OcrImage } from '../../../infrastructure/ai/types';
import type { ImportAssetInput } from './types';

export async function normalizeImageAsset(
  asset: ImportAssetInput,
  dependencies: { convertHeic?: typeof convertHeic } = {},
): Promise<OcrImage> {
  try {
    const heic = asset.mediaType === 'image/heic' || asset.mediaType === 'image/heif';
    const decoded = heic
      ? await (dependencies.convertHeic ?? convertHeic)({
          buffer: asset.content,
          format: 'JPEG',
          quality: 1,
        })
      : asset.content;
    const options = {
      page: 0,
      pages: 1,
      limitInputPixels: 50_000_000,
      sequentialRead: true,
    } as const;
    const metadata = await sharp(decoded, options).metadata();
    if (!metadata.width || !metadata.height) throw new Error('Missing dimensions');
    const pipeline = sharp(decoded, options)
      .rotate()
      .resize({
        width: 2_048,
        height: 2_048,
        fit: 'inside',
        withoutEnlargement: true,
      });
    const transparent = metadata.hasAlpha === true;
    const output = transparent
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
      : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return {
      mediaType: transparent ? 'image/png' : 'image/jpeg',
      base64: output.toString('base64'),
      position: asset.position,
    };
  } catch {
    throw new AppError('IMPORT_PARSE_FAILED', '图片无法解码', 422);
  }
}
```

Sharp strips metadata because the pipeline never calls `withMetadata`; `page: 0, pages: 1` fixes animated inputs to the first frame.

- [ ] **Step 5: Extend the AI types and Chat Completions client**

Add to `types.ts`:

```ts
export interface OcrImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  base64: string;
  position: number;
}

export interface OcrArticleText {
  title: string | null;
  text: string;
}
```

Add to `AiProvider`:

```ts
extractArticleText(
  images: readonly OcrImage[],
  signal: AbortSignal,
): Promise<OcrArticleText>;
```

Broaden the EvoLink client's message content only to this explicit union:

```ts
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
};
```

Add `timeoutMs?: number` to `GenerateTextInput`; pass it into `postJson`; create `AbortSignal.timeout(input.timeoutMs ?? this.config.timeoutMs)`. Preserve all existing response parsing and error sanitization.

- [ ] **Step 6: Implement the strict OCR prompt and provider parser**

Add `ocrMessages(images)` to `prompts.ts`. It returns one user message whose content starts with a text instruction requiring strict JSON `{ "title": string | null, "text": string }`, visible article text only, paragraph preservation, no summary/translation/invention, and source order. Append a text marker `Image position: N` immediately before each image part, then append:

```ts
{
  type: 'image_url' as const,
  image_url: {
    url: `data:${image.mediaType};base64,${image.base64}`,
  },
}
```

In `evolink-provider.ts`, add a strict schema and implementation:

```ts
const OcrArticleTextSchema = z.object({
  title: z.string().trim().min(1).max(160).nullable(),
  text: z.string().trim().min(1),
}).strict();

async extractArticleText(
  images: readonly OcrImage[],
  signal: AbortSignal,
): Promise<OcrArticleText> {
  if (images.length < 1 || images.length > 4) throw invalidOutput();
  const response = await this.client.generateText({
    model: this.visionModel,
    messages: ocrMessages(images),
    maxCompletionTokens: 8_000,
    reasoningEffort: 'low',
    responseFormat: 'json_object',
    timeoutMs: this.visionTimeoutMs,
  }, signal);
  const parsed = OcrArticleTextSchema.safeParse(extractJsonObject(response.text));
  if (!parsed.success) throw invalidOutput();
  return parsed.data;
}
```

Change the provider constructor to accept `{ visionModel, visionTimeoutMs }`, with no secret/client exposure. Update all construction sites and tests. The fake provider returns deterministic original prose containing each supplied immutable position and calls `signal.throwIfAborted()`.

- [ ] **Step 7: Implement ordered four-image batching**

Create `ocr.ts`:

```ts
import { AppError } from '../../../core/errors';
import type { AiProvider, OcrImage } from '../../../infrastructure/ai/types';
import type { ExtractedArticle } from './types';

export async function extractOrderedImageText(
  images: readonly OcrImage[],
  provider: Pick<AiProvider, 'extractArticleText'>,
  signal: AbortSignal,
): Promise<ExtractedArticle> {
  const ordered = [...images].sort((left, right) => left.position - right.position);
  if (
    ordered.length < 1 || ordered.length > 10 ||
    ordered.some((image, index) => image.position !== index)
  ) {
    throw new AppError('IMPORT_CONTENT_INVALID', '图片顺序无效', 422);
  }
  const results: Array<{ title: string | null; text: string }> = [];
  for (let index = 0; index < ordered.length; index += 4) {
    signal.throwIfAborted();
    try {
      results.push(await provider.extractArticleText(
        ordered.slice(index, index + 4),
        signal,
      ));
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AppError('IMPORT_OCR_FAILED', '图片文字暂时无法识别', 503, true);
    }
  }
  return {
    title: results.find((result) => result.title)?.title ?? null,
    text: results.map((result) => result.text.trim()).filter(Boolean).join('\n\n'),
  };
}
```

- [ ] **Step 8: Dispatch album and image-file jobs**

Extend `ArticleImportHandlerDependencies` with `provider: AiProvider`, `normalizeImage?: typeof normalizeImageAsset`, and `extractImages?: typeof extractOrderedImageText`. For `album`, require 1–10 ordered assets and every detected kind to be image. Pass the signature-detected media type into `normalizeImageAsset` (especially when the upload declared `application/octet-stream`), never the untrusted header value. For a local/computer image, use the same path with one asset. Normalize sequentially so memory holds at most one original plus normalized image at a time, then OCR in batches. Common validation and the existing lease-safe preview transaction remain the only persistence path.

Configure the provider in `server/src/index.ts` with:

```ts
const aiProvider = new EvolinkAiProvider(evolinkClient, {
  visionModel: config.EVOLINK_VISION_MODEL,
  visionTimeoutMs: config.EVOLINK_VISION_TIMEOUT_MS,
});
```

Ensure a retryable OCR error retains source assets and exhausted attempts enter `retryable`; image decode/unsupported errors are terminal and delete assets.

- [ ] **Step 9: Run OCR, handler, and AI regressions**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/imports/extractors/image.test.ts src/modules/imports/extractors/ocr.test.ts src/modules/imports/handler.integration.test.ts src/infrastructure/ai
npm test --workspace=@context-reader/server
npm run typecheck --workspace=@context-reader/server
npm run lint --workspace=@context-reader/server
```

Expected: 1/4/5/10-image order tests PASS, all provider tests PASS, and existing text generation/translation calls retain their payloads and timeouts.

- [ ] **Step 10: Commit image OCR importing**

```bash
git add server/src/types server/src/modules/imports server/src/infrastructure/ai server/src/index.ts
git commit -m "feat: import ordered article images"
```

### Task 8: Add ten-minute computer upload codes and a scriptless browser form

**Files:**
- Modify: `server/src/http/stream.ts`
- Modify: `server/src/http/stream.test.ts`
- Create: `server/src/modules/computer-upload/code.ts`
- Test: `server/src/modules/computer-upload/code.test.ts`
- Create: `server/src/modules/computer-upload/claim-limiter.ts`
- Test: `server/src/modules/computer-upload/claim-limiter.test.ts`
- Create: `server/src/modules/computer-upload/page.ts`
- Test: `server/src/modules/computer-upload/page.test.ts`
- Create: `server/src/modules/computer-upload/service.ts`
- Create: `server/src/modules/computer-upload/routes.ts`
- Test: `server/src/modules/computer-upload/computer-upload.integration.test.ts`
- Modify: `server/src/modules/imports/handler.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: anonymous bearer identity, idempotency, computer/import tables, raw stream hashing, file/image extractors, article-import jobs, public server origin, and Fastify cookie/form/multipart plugins.
- Produces: `deriveUploadCode`; `normalizeUploadCode`; `hashUploadCode`; `createCapabilityToken`; `capabilityMatches`; `ClaimAttemptLimiter`; safe HTML renderers; `createComputerUploadSession`; `claimComputerUploadSession`; `consumeComputerUpload`; `getComputerUploadSessionForUser`; and all phone/browser computer-upload routes.

- [ ] **Step 1: Write failing code, capability, limiter, and page tests**

Code tests must prove:

```ts
const first = deriveUploadCode('a'.repeat(64), userId, sessionId);
const replay = deriveUploadCode('a'.repeat(64), userId, sessionId);
expect(first).toBe(replay);
expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/u);
expect(normalizeUploadCode(`${first.slice(0, 5)}-${first.slice(5).toLowerCase()}`))
  .toBe(first);
expect(normalizeUploadCode('OIL01-ABCDE')).toBe('01101ABCDE');
expect(hashUploadCode(first)).toMatch(/^[0-9a-f]{64}$/u);

const capability = createCapabilityToken();
expect(capability.raw).not.toBe(capability.hash);
expect(capabilityMatches(capability.raw, capability.hash)).toBe(true);
expect(capabilityMatches(capability.raw + 'x', capability.hash)).toBe(false);
```

The derivation key material in the first argument is the raw 256-bit installation token available only during the authenticated request. HMAC input includes both owner ID and random session UUID, so idempotent replay reconstructs the same 50-bit code without storing it. Poll responses and database rows never expose the raw value.

With a fake clock, record five failures for one IP key and assert a sixth is rejected for ten minutes; do the same independently for a code-hash key. Advance exactly 600,000 ms and assert both buckets allow a new attempt. Successful claims do not add failures.

Page tests parse all returned strings and assert there is no `<script>`, external URL, tracker, user filename, source text, reflected code, or capability. Assert forms use only `/computer-upload/claim` and `/computer-upload/file`, the upload form has `enctype="multipart/form-data"`, and every dynamic error is selected from a fixed enum.

- [ ] **Step 2: Write failing browser/phone integration tests**

Exercise the complete flow:

1. authenticated `POST /v1/computer-upload-sessions` returns a ten-character code, explicit configured upload URL, ten-minute expiry, and `awaiting_upload` import;
2. replay with the same installation token and idempotency key returns the same session/code; changed request identity conflicts;
3. database session contains only `codeHash`, never code;
4. phone GET is owner-only and never returns code/capability;
5. invalid claims share one fixed response and are limited to five per IP and five per code hash;
6. valid claim atomically changes `awaiting_code -> claimed` and sets an `HttpOnly; SameSite=Strict; Path=/computer-upload` cookie, plus `Secure` under an HTTPS configured origin;
7. two concurrent valid claims yield one capability;
8. multipart upload ignores the supplied filename, streams one accepted file, atomically consumes capability, stores one asset, moves import to queued, and creates one job;
9. concurrent/second upload returns `UPLOAD_SESSION_USED` and creates no second asset/job;
10. expired code/capability returns `UPLOAD_SESSION_EXPIRED`, clears capability hash, and creates no job;
11. phone polling moves through its session/import status and another bearer always receives 404;
12. POST requests with a foreign `Origin` or `Sec-Fetch-Site: cross-site` are rejected.

Build the multipart bytes with Node 22's standards objects so the test adds no package:

```ts
const form = new FormData();
form.set(
  'file',
  new Blob([txt], { type: 'text/plain' }),
  'private-hostile-name.txt',
);
const encoded = new Request('http://localhost/computer-upload/file', {
  method: 'POST',
  body: form,
});
const payload = Buffer.from(await encoded.arrayBuffer());
const contentType = encoded.headers.get('content-type');
if (!contentType) throw new Error('Multipart content type missing');
const uploaded = await app.inject({
  method: 'POST',
  url: '/computer-upload/file',
  headers: { cookie, 'content-type': contentType },
  payload,
});
expect(uploaded.body).not.toContain('private-hostile-name.txt');
```

- [ ] **Step 3: Run focused tests and verify computer modules are missing**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/computer-upload src/http/stream.test.ts
```

Expected: FAIL because code/session/page/capability behavior does not exist.

- [ ] **Step 4: Implement deterministic 50-bit Crockford codes and capability hashing**

Create `code.ts`:

```ts
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { AppError } from '../../core/errors';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/u;

export function deriveUploadCode(
  installationToken: string,
  userId: string,
  sessionId: string,
): string {
  const digest = createHmac('sha256', installationToken)
    .update(`context-reader-computer-upload-v1\u0000${userId}\u0000${sessionId}`, 'utf8')
    .digest();
  let value = digest.readBigUInt64BE(0) & ((1n << 50n) - 1n);
  let code = '';
  for (let index = 0; index < 10; index += 1) {
    code = ALPHABET[Number(value & 31n)]! + code;
    value >>= 5n;
  }
  return code;
}

export function normalizeUploadCode(value: string): string {
  const normalized = value.toUpperCase()
    .replace(/[\s-]/gu, '')
    .replace(/O/gu, '0')
    .replace(/[IL]/gu, '1');
  if (!CODE_PATTERN.test(normalized)) {
    throw new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
  }
  return normalized;
}

export function hashUploadCode(code: string): string {
  return createHash('sha256').update(normalizeUploadCode(code), 'utf8').digest('hex');
}

export function createCapabilityToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return {
    raw,
    hash: createHash('sha256').update(raw, 'utf8').digest('hex'),
  };
}

export function capabilityMatches(raw: string, expectedHash: string): boolean {
  const actual = createHash('sha256').update(raw, 'utf8').digest();
  const expected = Buffer.from(expectedHash, 'hex');
  return expected.byteLength === actual.byteLength && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 5: Implement the two-key failed-claim limiter**

Create an injectable in-process sliding-window limiter, scoped to this single API process:

```ts
import { AppError } from '../../core/errors';

export class ClaimAttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maximumFailures = 5,
    private readonly windowMs = 600_000,
    private readonly now: () => number = Date.now,
  ) {}

  assertAllowed(keys: readonly string[]): void {
    const timestamp = this.now();
    for (const key of keys) {
      const active = this.activeFailures(key, timestamp);
      if (active.length >= this.maximumFailures) {
        throw new AppError('RATE_LIMITED', '尝试次数过多，请稍后再试', 429, true);
      }
    }
  }

  recordFailure(keys: readonly string[]): void {
    const timestamp = this.now();
    for (const key of keys) {
      const active = this.activeFailures(key, timestamp);
      active.push(timestamp);
      this.failures.set(key, active);
    }
  }

  private activeFailures(key: string, timestamp: number): number[] {
    const active = (this.failures.get(key) ?? [])
      .filter((entry) => timestamp - entry < this.windowMs);
    if (active.length === 0) this.failures.delete(key);
    else this.failures.set(key, active);
    return active;
  }
}
```

The route hashes IP before making the `ip:<digest>` key and uses `code:<codeHash>` for the second key. Call `assertAllowed` before database claim and `recordFailure` only when claim fails. Do not log either key.

- [ ] **Step 6: Add an unknown-length bounded multipart reader**

Extend `server/src/http/stream.ts`:

```ts
export async function readBoundedMultipartStream(
  stream: Readable,
  input: { maxBytes: number; signal?: AbortSignal },
): Promise<ReadStreamResult> {
  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const rawChunk of stream) {
    input.signal?.throwIfAborted();
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    byteSize += chunk.byteLength;
    if (byteSize > input.maxBytes) {
      stream.destroy();
      throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
    }
    chunks.push(chunk);
    hash.update(chunk);
  }
  if (byteSize === 0) throw new AppError('IMPORT_CONTENT_INVALID', '上传文件为空', 422);
  return { content: Buffer.concat(chunks), byteSize, sha256: hash.digest('hex') };
}
```

- [ ] **Step 7: Implement scriptless pages and fixed security headers**

Export `renderCodePage()`, `renderUploadPage()`, `renderDonePage()`, and `renderBrowserErrorPage(kind)` from `page.ts`. Each returns a complete UTF-8 HTML document with inline CSS only, a fixed Chinese heading/copy, and no interpolation of user input. Apply these headers on every browser response:

```ts
const browserHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;
```

Claim form fields are only `code`; upload form fields are only `file`. No filename or article content appears after upload.

- [ ] **Step 8: Implement session creation, claim, consumption, and polling services**

Use these exact signatures:

```ts
export function createComputerUploadSession(
  db: AppDatabase,
  input: {
    userId: string;
    installationToken: string;
    idempotencyKey: string;
    publicServerOrigin: string;
    ttlMs: number;
    draftTtlMs: number;
  },
): Promise<CreatedComputerUploadSession>;

export function claimComputerUploadSession(
  db: AppDatabase,
  input: { normalizedCode: string; capability: { raw: string; hash: string }; now: Date },
): Promise<{ capabilityToken: string; expiresAt: Date }>;

export function consumeComputerUpload(
  db: AppDatabase,
  input: {
    capabilityToken: string;
    mediaType: string;
    content: Buffer;
    byteSize: number;
    sha256: string;
    jobDeadlineMs: number;
    now: Date;
  },
): Promise<{ importId: string }>;

export function getComputerUploadSessionForUser(
  db: AppDatabase,
  input: { userId: string; sessionId: string },
): Promise<ComputerUploadSessionDto>;
```

Creation begins `create_computer_upload_session`; on a new operation generate a session UUID, derive the code from installation token + user + session, insert a `computer`/`awaiting_upload` import and `awaiting_code` session in one transaction, and finish idempotency against the session ID. On replay, load the owned session and re-derive the same code from its ID. Thus the raw code is reproducible only to the authenticated installation holding its token, never persisted, and never returned by GET.

Claim locks by `codeHash`, expires stale sessions before returning a generic error, requires `awaiting_code`, writes only capability hash, and returns raw capability once to the route for its cookie. Consumption finds by capability hash, locks session/import, checks expiry and `capabilityMatches`, requires `claimed + awaiting_upload`, inserts position-zero asset, sets session uploaded and clears capability hash, moves import queued, and inserts one job in the same transaction.

Polling joins the owner session to its import and calls the existing import serializer. It opportunistically expires an overdue non-uploaded session in a transaction, clears capability, marks import expired, and deletes assets.

- [ ] **Step 9: Register authenticated phone routes and public browser routes**

Register cookie, formbody, and multipart inside the computer-upload plugin. Configure multipart with `files: 1`, `fields: 0`, and `fileSize: config.IMPORT_MAX_FILE_BYTES`; reject a second part or truncated stream.

Routes are exact:

```text
POST /v1/computer-upload-sessions
GET  /v1/computer-upload-sessions/:id
GET  /computer-upload
POST /computer-upload/claim
POST /computer-upload/file
```

The authenticated create route parses the bearer token again with `parseBearerToken` only to supply HMAC key material, never stores/logs it, and requires an idempotency key. Browser POST routes require `Origin` absent or equal to configured origin and `Sec-Fetch-Site` absent/`none`/`same-origin`. Claim normalizes code, invokes the two-key limiter, and on success sets:

```ts
reply.setCookie('cr_upload', capabilityToken, {
  httpOnly: true,
  sameSite: 'strict',
  secure: new URL(options.config.publicServerOrigin).protocol === 'https:',
  path: '/computer-upload',
  expires: expiresAt,
});
```

File upload reads only `part.file` with `readBoundedMultipartStream`, ignores `part.filename`, stores `part.mimetype` only as an untrusted declared MIME, consumes the session, clears the cookie, and returns the fixed done page. Register the plugin in `buildApp`.

- [ ] **Step 10: Let computer assets use the existing document/image dispatch**

In the import handler, treat source kind `computer` as exactly one position-zero asset and route it through the same magic-byte document/image detection used by local file. Do not add a computer-specific parser or OCR prompt.

- [ ] **Step 11: Run computer, import, and security gates**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/computer-upload src/http/stream.test.ts src/modules/imports src/plugins/security.test.ts
npm test --workspace=@context-reader/server
npm run typecheck --workspace=@context-reader/server
npm run lint --workspace=@context-reader/server
```

Expected: all claim/upload races and page-policy tests PASS; no response/log contains code, token, filename, or bytes.

- [ ] **Step 12: Commit computer upload**

```bash
git add server/src/http server/src/modules/computer-upload server/src/modules/imports server/src/app.ts
git commit -m "feat: add single-use computer uploads"
```

### Task 9: Enforce expiry cleanup, sanitized logging, and terminal-path invariants

**Files:**
- Create: `server/src/modules/imports/cleanup.ts`
- Test: `server/src/modules/imports/cleanup.integration.test.ts`
- Create: `server/src/modules/imports/cleanup-runner.ts`
- Test: `server/src/modules/imports/cleanup-runner.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`
- Modify: `server/src/plugins/security.ts`
- Modify: `server/src/plugins/security.test.ts`
- Modify: `server/src/modules/imports/handler.integration.test.ts`
- Modify: `server/src/modules/computer-upload/computer-upload.integration.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: import/session timestamps and states, temporary assets, active jobs, process shutdown, Fastify public-error mapping, and Pino redaction.
- Produces: `sweepImportCleanup`; `startImportCleanupRunner`; deterministic expiry/TTL cleanup; sanitized unexpected-error logging; and terminal-path deletion guarantees.

- [ ] **Step 1: Write failing database cleanup tests for every terminal path**

Seed separate imports for awaiting upload, queued, processing, retryable, preview ready, confirmed, failed, expired, and cancelled. Give each an asset at a controlled timestamp and seed active/stale jobs where relevant. Assert one sweep produces this matrix:

| Resource before sweep | Age/state condition | Required result |
| --- | --- | --- |
| awaiting upload | partial asset older than 24 h, draft still live | delete asset, keep awaiting import |
| awaiting upload | import `expiresAt <= now` | mark import expired and delete assets |
| retryable with assets | oldest asset at/above 24 h | mark import expired, clear failure, delete assets |
| retryable URL | import `expiresAt <= now` | mark expired |
| preview ready | draft `expiresAt <= now` | mark expired, clear preview/hash/fingerprint, delete assets |
| computer awaiting/claimed | session `expiresAt <= now` | session expired, capability cleared, linked import expired, assets deleted |
| confirmed/failed/expired/cancelled | any surviving asset | delete asset without changing terminal resource |
| queued/processing | valid active job | skip asset deletion |
| queued/processing | no active job and deadline passed | mark failed with `IMPORT_DEADLINE_EXCEEDED`, delete assets |

Run two concurrent sweeps and assert each row is handled once via `FOR UPDATE SKIP LOCKED`. Run the sweep again and assert zero mutations. Confirm no article is created and a confirmed article's paragraphs remain.

- [ ] **Step 2: Write failing cleanup-runner and logging-redaction tests**

With fake timers, inject a sweep spy, advance 60 seconds twice, and assert two non-overlapping calls. Abort while a sweep is in flight, resolve it, and assert `stop()` waits for it and no next timer runs.

In `app.test.ts`, use a destination stream and unique canaries for URL, filename, upload code, capability, OCR Base64, preview/article text, cookie, bearer token, database URL, and API key. Trigger validation and injected unexpected errors. Assert no canary appears anywhere in captured output or public response, while request ID and a fixed error classification still appear.

- [ ] **Step 3: Run focused tests and verify cleanup/hardening failures**

Run:

```bash
npm test --workspace=@context-reader/server -- src/modules/imports/cleanup.integration.test.ts src/modules/imports/cleanup-runner.test.ts src/app.test.ts src/plugins/security.test.ts
```

Expected: FAIL because cleanup and the expanded logging policy are absent.

- [ ] **Step 4: Implement transactional, bounded cleanup batches**

Expose:

```ts
export interface ImportCleanupResult {
  expiredImports: number;
  expiredSessions: number;
  deletedAssets: number;
  failedOrphanedWork: number;
}

export function sweepImportCleanup(
  db: AppDatabase,
  input: {
    now: Date;
    assetTtlMs: number;
    batchSize?: number;
  },
): Promise<ImportCleanupResult>;
```

Use batches of at most 100 IDs. Each selector is a parameterized CTE ordered by expiry/creation time with `FOR UPDATE SKIP LOCKED LIMIT batchSize`; never interpolate an identifier. In the same transaction as each state update:

- delete assets selected for terminal cleanup;
- clear preview fields when moving `preview_ready -> expired`;
- clear failure fields when moving `retryable -> expired`;
- set fixed safe deadline fields when an orphaned queued/processing import has no active queued/running job;
- clear capability hash before marking a session expired;
- apply `assertImportTransition` for every nonterminal state change.

Do not delete long-lived imported articles, paragraphs, translations, imports, sessions, jobs, or idempotency records in this sweep. Keep the resource history while removing only source bytes and expired draft text.

- [ ] **Step 5: Implement an abortable periodic cleanup lifecycle**

Create `cleanup-runner.ts`:

```ts
export function startImportCleanupRunner(options: {
  intervalMs?: number;
  sweep: () => Promise<unknown>;
}): { stop(): Promise<void> } {
  const controller = new AbortController();
  const done = run(options, controller.signal);
  return {
    async stop() {
      controller.abort();
      await done;
    },
  };
}

async function run(
  options: { intervalMs?: number; sweep: () => Promise<unknown> },
  signal: AbortSignal,
): Promise<void> {
  const intervalMs = options.intervalMs ?? 60_000;
  while (!signal.aborted) {
    await abortableDelay(intervalMs, signal);
    if (signal.aborted) return;
    try {
      await options.sweep();
    } catch {
      if (signal.aborted) return;
    }
  }
}
```

Implement `abortableDelay` with a timer and one abort listener, removing both on completion. Only one sweep runs at a time because the loop awaits it.

- [ ] **Step 6: Harden public error conversion and logs**

Expand `redactPaths` with:

```ts
'req.headers.cookie',
'request.headers.cookie',
'*.sourceUrl',
'*.previewText',
'*.previewTitle',
'*.filename',
'*.uploadCode',
'*.capabilityToken',
'*.codeHash',
'*.capabilityTokenHash',
'*.content',
'*.base64',
'*.text',
```

Keep `req.body`/`request.body` redacted. Change unexpected logging from `{ err: error }` to a fixed safe classification that excludes message, stack, cause, request body, URL source, and third-party parser fields:

```ts
request.log.error({
  errorType: error instanceof AppError ? 'AppError' : 'UnexpectedError',
  errorCode: typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'UNCLASSIFIED',
}, 'Unhandled request error');
```

Allowlist `errorCode` to Fastify/internal code syntax before logging; otherwise use `UNCLASSIFIED`. Never log an arbitrary provider code.

Make `toPublicError(error, request)` return `IMPORT_TOO_LARGE` for body/multipart-limit error codes on import/browser-upload routes, preserve `VALIDATION_ERROR` for unrelated JSON bodies, and return `IMPORT_UNSUPPORTED_TYPE` for invalid upload MIME. Every other unknown remains retryable `INTERNAL_ERROR` without raw details.

- [ ] **Step 7: Start and stop cleanup with the server process**

After HTTP readiness succeeds and before accepting worker work, start:

```ts
cleanup = startImportCleanupRunner({
  sweep: () => sweepImportCleanup(database.db, {
    now: new Date(),
    assetTtlMs: config.IMPORT_ASSET_TTL_MS,
  }),
});
```

Shutdown order is cleanup runner, job runner, HTTP app, then database pool. Preserve the current idempotent `shutdownPromise` and signal handlers. A cleanup failure must not crash the API; startup still fails if job registration is incomplete.

- [ ] **Step 8: Add terminal-path security regression assertions**

Extend import/computer tests to query `import_assets` after each success, permanent failure, cancel, expiry, and computer-session reuse. Assert zero rows every time. For `retryable`, assert rows exist before TTL and disappear exactly at TTL. Serialize every public error and assert it lacks SQL fragments, parser class names, hostname/IP, URL, MIME details, filenames, hashes, extracted text, and provider response.

- [ ] **Step 9: Run repeated cleanup/race and full repository gates**

Run:

```bash
for i in 1 2 3; do npm test --workspace=@context-reader/server -- src/modules/imports/cleanup.integration.test.ts src/modules/computer-upload/computer-upload.integration.test.ts || exit 1; done
npm run check
npm run build
```

Expected: all three race runs PASS; workspace typecheck/tests/lint/build all exit 0; no secret canary appears in output.

- [ ] **Step 10: Commit cleanup and security hardening**

```bash
git add server/src/modules/imports server/src/modules/computer-upload server/src/app.ts server/src/app.test.ts server/src/plugins server/src/index.ts
git commit -m "feat: expire and sanitize article imports"
```

### Task 10: Run real Neon/EvoLink acceptance, scan client boundaries, and document the backend

**Files:**
- Create: `server/scripts/import-live-smoke.ts`
- Modify: `server/scripts/check-client-secrets.ts`
- Modify: `server/package.json`
- Modify: `README.md`
- Modify: `server/README.md`
- Modify: `app/.env.example`
- Modify: `app/.gitignore`

**Interfaces:**
- Consumes: all backend routes, explicit migration runner, configured Neon/EvoLink environment, current practice smoke, Expo web export, and Git remote `origin`.
- Produces: an opt-in five-source import smoke; a source/export server-variable and secret-value scanner; exact operator documentation; twice-applied real migration evidence; full automated/build evidence; and a pushed backend branch.

- [ ] **Step 1: Write the opt-in live import smoke before calling real services**

Add this script entry:

```json
{
  "scripts": {
    "smoke:imports": "node --env-file=../app/.env --import tsx scripts/import-live-smoke.ts",
    "check:client-secrets": "node --env-file=../app/.env --import tsx scripts/check-client-secrets.ts"
  }
}
```

`import-live-smoke.ts` must refuse to start unless `RUN_IMPORT_LIVE_SMOKE=1`. Reuse the existing safe request/polling style, but define import-specific helpers:

```ts
async function waitForImport(importId: string): Promise<ArticleImportDto>;
async function uploadRawAsset(
  importId: string,
  position: number,
  mediaType: string,
  bytes: Buffer,
): Promise<ArticleImportDto>;
async function confirmPreview(importId: string): Promise<ArticleImportDto>;
async function waitForArticleTranslation(
  initial: ArticleTranslationDto,
): Promise<ArticleTranslationDto>;
```

Create a fresh random installation token and register the anonymous identity. Exercise all five sources with original synthetic English prose:

```ts
const sourceCases = [
  { kind: 'url' as const, url: 'https://www.rfc-editor.org/rfc/rfc2606.html' },
  { kind: 'paste' as const },
  { kind: 'album' as const },
  { kind: 'local_file' as const },
  { kind: 'computer' as const },
];
```

- URL: create, poll to preview, confirm.
- Paste: stream the synthetic prose, confirm.
- Album: rasterize two clean 1,200-pixel PNGs from an SVG containing different ordered halves of the prose, upload in positions 0/1, process, poll OCR, confirm.
- Local: generate the deterministic DOCX fixture in memory, upload/process/poll/confirm.
- Computer: create a session, POST the code form while retaining the returned cookie, multipart-upload a generated UTF-8 TXT file, poll from the phone identity, confirm.

For every source, assert a preview has 20–5,000 words, confirmation returns an article ID, article paragraphs are ordered, and no final failure creates an article. Request one paragraph and one full article translation, poll both to ready, and assert Han text. Replay at least creation, processing, confirmation, and translation idempotency keys and assert stable resource IDs.

The script may query Neon only after API acceptance to assert no `import_assets` row remains for confirmed/failed imports. It prints only source kind, resource UUIDs, states, word/paragraph counts, configured model name, and elapsed milliseconds. It must never print code, cookie, URL body, title, prose, OCR payload, translation, database URL, API key, filename, digest, or failure internals.

- [ ] **Step 2: Expand the client source/export secret scanner**

Scan `app/src` and `app/dist-smoke`; do not scan `.env.example`, because it intentionally documents names. Reject every occurrence of these server-only names:

```ts
const serverOnlyNames = [
  'DATABASE_URL',
  'EVOLINK_API_KEY',
  'EVOLINK_BASE_URL',
  'EVOLINK_TEXT_MODEL',
  'EVOLINK_MODERATION_MODEL',
  'EVOLINK_TIMEOUT_MS',
  'PUBLIC_SERVER_ORIGIN',
  'EVOLINK_VISION_MODEL',
  'EVOLINK_VISION_TIMEOUT_MS',
  'IMPORT_MAX_TEXT_BYTES',
  'IMPORT_MAX_FILE_BYTES',
  'IMPORT_MAX_TOTAL_BYTES',
  'IMPORT_FETCH_MAX_BYTES',
  'IMPORT_FETCH_TIMEOUT_MS',
  'IMPORT_JOB_DEADLINE_MS',
  'COMPUTER_UPLOAD_TTL_MS',
  'IMPORT_ASSET_TTL_MS',
  'IMPORT_DRAFT_TTL_MS',
] as const;
```

Also compare file bytes with the configured values of `DATABASE_URL` and `EVOLINK_API_KEY` without printing either value. `EXPO_PUBLIC_API_BASE_URL` is the sole allowed import-related client variable. Output only file count, number of configured secrets checked, and a success sentence.

- [ ] **Step 3: Update exact configuration and operator documentation**

Ensure `app/.env.example` contains every variable from design section 15 with exact defaults and blank `PUBLIC_SERVER_ORIGIN`. Document:

- phone and server must be reachable on the same LAN during Expo Go development;
- both `EXPO_PUBLIC_API_BASE_URL` and `PUBLIC_SERVER_ORIGIN` use the machine's current LAN address, so changing Wi-Fi can require updating them and restarting both processes;
- database migration is explicit and safe to rerun;
- binary data is temporary in Neon, with the 10 MiB/30 MiB/24 h limits;
- scanned PDFs must be supplied as album images;
- computer upload code/capability lifetime and single-use behavior;
- URL SSRF protections and non-bypass/non-goals;
- all import states, public routes, success statuses, idempotency behavior, and public error codes;
- the commands below and their expected operator-visible outcomes.

Keep the existing practice documentation and verified history; add an article-import section rather than replacing it.

- [ ] **Step 4: Run all static and automated gates**

Run:

```bash
npm run check
npm run build
npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke
npm run check:client-secrets --workspace=@context-reader/server
git diff --check
```

Expected: all contracts/server/client tests, typechecks, and lints PASS; server build and Expo export succeed; the scanner reports no server-only name/value; Git reports no whitespace errors. Add `dist-smoke/` to `app/.gitignore`, then remove only that exact generated directory after verification.

- [ ] **Step 5: Apply the real Neon migration twice**

Run:

```bash
npm run db:migrate --workspace=@context-reader/server
npm run db:migrate --workspace=@context-reader/server
```

Expected: both commands exit 0; the second applies no duplicate objects and never drops/recreates `public`. Query only catalog names/counts to verify six new tables and both job enum values; do not print rows or connection details.

- [ ] **Step 6: Run existing and import live smokes**

Start the server in one terminal and wait for a 200 readiness response:

```bash
npm run dev
```

In another terminal run:

```bash
RUN_LIVE_SMOKE=1 npm run smoke:live --workspace=@context-reader/server
RUN_IMPORT_LIVE_SMOKE=1 npm run smoke:imports --workspace=@context-reader/server
```

Expected: the existing practice/translation smoke remains green; all five import sources reach preview and confirmation; real image OCR uses `deepseek-v4-flash-vision-exp`; paragraph/full article translations reach ready; confirmed imports have no temporary asset rows. A clean retryable provider failure is acceptable only if its error contract/assets/TTL are correct and the same command later succeeds within the configured account availability.

- [ ] **Step 7: Exercise the browser upload form manually once**

From the phone-authenticated API create a new session, open the exact displayed `uploadUrl` in a separate desktop browser, enter the displayed code, and upload one synthetic TXT/DOCX file. Verify the phone poll reaches the same import ID and preview. Refresh/re-submit the browser form and assert it cannot reuse the capability. Inspect response headers for CSP, nosniff, no framing, no referrer, and no-store. Record browser, result, and timing in `server/README.md` without code, filename, or article data.

- [ ] **Step 8: Capture any acceptance defect as a focused regression**

If a gate exposes a defect, return to the task owning that module, add the smallest test that fails for the observed case, run it to see the failure, apply the minimum fix, rerun its focused suite plus `npm run check`, and create a focused `fix:` commit. Do not weaken assertions, raise limits, bypass URL policy, or expose provider details to make a smoke pass.

- [ ] **Step 9: Inspect repository state and commit documentation/acceptance tooling**

Run:

```bash
git status --short
git diff --stat HEAD
git diff --check
```

Expected: no `.env`, database dump, Expo export, uploaded source, image, code/cookie capture, or unrelated user file is staged.

```bash
git add README.md server/README.md server/scripts/import-live-smoke.ts server/scripts/check-client-secrets.ts server/package.json app/.env.example app/.gitignore package-lock.json
git commit -m "docs: finish article import backend acceptance"
```

- [ ] **Step 10: Push the completed backend branch requested by the user**

Run:

```bash
git push -u origin codex/cloud-core-backend
```

Expected: GitHub remote `https://github.com/fang20030527/story_tree.git` accepts the branch and reports it up to date. Do not force-push. Report the pushed commit SHA and branch.

---

## Final Verification Checklist

- [ ] All public request/response objects parse through strict shared Zod schemas and reject extra fields.
- [ ] The import transition matrix contains every approved edge and no unapproved edge.
- [ ] Paste reaches preview without AI, asset rows, practice rows, quiz rows, vocabulary rows, or quota rows.
- [ ] URL fetching rejects private/reserved/metadata destinations, mixed DNS answers, unsafe redirects, and DNS rebinding while pinning the validated address.
- [ ] TXT/Markdown/HTML/DOCX/text-PDF parsing preserves order; empty/scanned PDF returns photo guidance; magic bytes win over names/extensions.
- [ ] Album accepts 1–10 ordered images; HEIC and other images are decoded, oriented, stripped, bounded, first-frame only, and OCR batches contain at most four images.
- [ ] EvoLink OCR sends only normalized private image data to the configured vision model and accepts only strict title/text output.
- [ ] Computer codes carry 50 bits, expire in ten minutes, are rate-limited by both IP/code hash, are not stored raw, and cannot be reused.
- [ ] Confirmation handles exact/similar decisions atomically and stores one owner-only article with immutable ordered paragraphs.
- [ ] Article paragraph/full translation uses only `article_translations`, caches correctly, validates/moderates output, and does not record practice assistance.
- [ ] Lease loss prevents every preview, failure, and translation result write.
- [ ] Automatic attempts stop at three and five minutes; explicit retry reuses the import ID only while its source remains valid.
- [ ] Success, terminal failure, cancellation, expiry, and cleanup leave no temporary asset; retryable source bytes never survive 24 hours.
- [ ] Logger, public errors, source code, and Expo export reveal no source data, URL, filename, upload code, cookie/capability, OCR Base64, provider internals, database URL, or API key.
- [ ] Existing practice, quiz, vocabulary, assistance, evidence, translation, quota, and dashboard suites remain unchanged and green.
- [ ] `npm run check`, `npm run build`, Expo export, secret scan, and twice-applied real migration exit 0.
- [ ] Existing real practice smoke and five-source import smoke pass against configured Neon/EvoLink.
- [ ] The final branch is pushed without force to `origin/codex/cloud-core-backend`.
