# Article Import and Computer Upload Design

**Date:** 2026-09-08
**Status:** Approved for implementation planning
**Scope:** Make every import control on the Expo feed perform a complete, recoverable article-import workflow.

## 1. Goal

Turn the five existing feed controls—web URL, pasted text, photo album, local file, and computer upload—into real end-to-end features. Every source must converge on the same editable preview, private article, and translation experience.

The implementation must continue using Expo SDK 54, the existing Fastify modular monolith, Neon PostgreSQL, the PostgreSQL lease queue, and EvoLink. It must not require a new object-storage account for the first release.

## 2. Approved Product Decisions

- All five controls are in scope.
- A successful import follows: source input → durable processing → editable preview → explicit confirmation → private article reading.
- Imported articles support paragraph and full-text translation.
- Importing does not automatically create a quiz or vocabulary item.
- Photo import accepts 1–10 ordered images, with a 10 MB per-image and 30 MB aggregate upload limit.
- Local and computer import accept PDF, DOCX, TXT, HTML, JPEG, PNG, WebP, GIF, and HEIC input.
- A text-only PDF is parsed directly. A PDF without extractable text fails with guidance to import page images through the photo flow.
- Computer import uses a ten-minute, single-use upload code and a browser upload page.
- Uploaded binary data is temporary. Only the extracted private article copy is retained long-term.

## 3. Non-goals

This slice does not include:

- automatic vocabulary detection, sense selection, dictionary lookup, or quiz generation;
- paywall, login, CAPTCHA, anti-bot, or robots-restriction bypass;
- audio, video, subtitle, EPUB, Pages, or proprietary office formats;
- scanned-PDF page rendering on the server;
- public article sharing or a public article library;
- permanent retention or redownload of an uploaded source file;
- an object-storage integration;
- notes, arbitrary text highlighting, or article editing after final confirmation;
- changes to the proven generated-practice tables or answer evidence.

## 4. Architecture

All sources enter one import state machine and produce one normalized preview model:

```text
Expo source adapter
  → authenticated import record
  → optional bounded asset upload
  → durable article_import job
  → source-specific extraction
  → common validation and paragraph normalization
  → preview_ready
  → user edit and duplicate decision
  → confirmed private article
  → independent article translation jobs
```

The server gains three bounded modules:

- `imports`: import creation, asset upload, extraction, validation, preview editing, confirmation, and cleanup.
- `articles`: ownership-safe article and paragraph reads.
- `computer-upload`: ten-minute code creation, capability exchange, browser upload page, and upload completion.

The shared contracts package defines every public request and response. Route handlers authenticate, parse, and map HTTP only. Services own transactions and state rules. Repositories own Drizzle queries. Source adapters implement one extraction interface and do not know about HTTP or database state.

Existing practice translation remains unchanged. Imported articles use a separate translation table and handler that reuse small pure translation-validation helpers and the existing `AiProvider.translate` boundary. This avoids weakening practice foreign keys or changing previously accepted answer/assistance behavior.

## 5. Import State Model

`ArticleImportStatus` has these values:

```text
awaiting_upload
queued
processing
retryable
preview_ready
confirmed
failed
expired
cancelled
```

Allowed transitions are:

```text
awaiting_upload → queued | expired | cancelled
queued          → processing | failed | cancelled
processing      → preview_ready | queued | retryable | failed | cancelled
retryable       → queued | expired | cancelled
preview_ready   → confirmed | expired | cancelled
confirmed       → (terminal)
failed          → (terminal)
expired         → (terminal)
cancelled       → (terminal)
```

The `processing → queued` edge is permitted only for one of the job runner's three automatic attempts. When those attempts end with a provider or transient parser error that a user can meaningfully retry, the import enters `retryable` and retains its assets for at most 24 hours. An explicit retry creates a fresh job and keeps the same import ID. Deterministic validation, unsupported formats, deadlines, and unsafe URLs enter terminal `failed` and delete assets immediately. A confirmed import cannot be edited or reprocessed.

The server supplies `pollAfterMs` only for `awaiting_upload`, `queued`, and `processing`. Clients stop polling on every other state and expose retry only for `retryable`.

## 6. Source Behavior

### 6.1 Web URL

The client submits one absolute URL. The server:

1. accepts only `http:` or `https:`;
2. rejects embedded credentials and nonstandard URL ambiguity;
3. resolves the hostname and rejects every loopback, private, link-local, multicast, reserved, and cloud metadata address;
4. pins the validated address for the connection so DNS rebinding cannot bypass validation;
5. follows at most five redirects manually and repeats the complete validation for each target;
6. sends no cookies, authorization, referrer, or browser identity from the user;
7. accepts only `text/html` or `application/xhtml+xml`, ignoring parameters such as charset;
8. stops after 5 MB of response bytes or 15 seconds;
9. parses static HTML without executing scripts or loading subresources;
10. extracts a title and main readable text, then enters common validation.

Blocked, login-only, paywalled, empty, or extraction-resistant pages fail without creating an article. The failure response recommends pasted text.

### 6.2 Pasted Text

The client opens an editable multiline field. It may read the clipboard only after an explicit user press. The submitted value is normalized and validated on the server. No AI request is required to import pasted text.

### 6.3 Photo Album

The client requests photo-library permission only after the user selects the photo source. It accepts 1–10 images, displays thumbnails in processing order, permits removal and reordering before submission, and shows byte limits before upload.

HEIC is decoded and converted to JPEG before OCR. Other accepted images are decoded, orientation-corrected, metadata-stripped, resized to a maximum 2,048-pixel long edge, and encoded as JPEG quality 82 unless transparency requires PNG. Decode failure is an invalid-file error.

OCR uses a dedicated configured multimodal model through EvoLink's OpenAI-compatible image-content request. Ordered images are divided into batches of at most four images, and each image is tagged with its immutable position. Batch results are concatenated only in source order. The prompt requests visible article text only, preserves paragraph boundaries, and must not summarize, translate, or invent missing words.

### 6.4 Local File

The client opens the operating-system document picker and sends the chosen file through the same bounded asset protocol.

- TXT: UTF-8 with optional BOM; invalid encoding fails.
- HTML: static main-text extraction using the same parser as URL import; no subresources are fetched.
- DOCX: paragraph text extraction; macros, embedded files, comments, and images are ignored.
- PDF: text extraction in page order. If extraction produces fewer than 20 English word tokens, the user is directed to photo import.
- JPEG, PNG, WebP, GIF, or HEIC: follows the photo OCR pipeline.

Animated images use only the first frame. A file extension never overrides detected magic bytes and media type.

### 6.5 Computer Upload

The phone creates an authenticated computer-upload session. The server returns:

- the session ID for authenticated phone polling;
- a browser upload URL derived by the server from configured public origin;
- a human-readable ten-character Crockford Base32 code carrying 50 bits of entropy;
- an absolute expiry timestamp ten minutes in the future.

The browser page contains no external script, tracker, analytics, or user article data. The user enters the code. The server hashes the normalized code to find the session, permits at most five failed claims per IP and five per code hash in ten minutes, and exchanges a valid code for an `HttpOnly`, `SameSite=Strict` capability cookie that expires with the session and never lives longer than ten minutes. The raw code is never stored.

The browser may upload one accepted file. Successful upload consumes the session atomically and enqueues the linked import. A second upload, an expired code, or a reused capability fails. The phone polls only its authenticated session and automatically continues to the common processing and preview screens.

## 7. Common Content Validation

All extracted content passes the same deterministic pipeline:

1. normalize Unicode to NFKC and line endings to `\n`;
2. remove disallowed control characters and repeated empty lines;
3. preserve paragraph order while collapsing intra-line whitespace;
4. require at least one nonempty paragraph, at least 20 English word tokens, and fewer than 2% replacement/control characters;
5. for text of at least 100 characters, require an English language-detector result; for shorter accepted text, require at least 80% of letter characters to use the Latin script;
6. count English words and reject content above 5,000 words without truncation;
7. use a nonempty extracted title of at most 160 characters, otherwise the first nonempty line of at most 160 characters, otherwise `导入文章`;
8. compute a normalized SHA-256 content hash and a 64-bit similarity fingerprint;
9. split the body into immutable ordered paragraphs for preview and later confirmation.

The preview edit endpoint reruns the same validation and recomputes both fingerprints. It never trusts word counts or hashes sent by the client.

Exact duplicates are unique per user and resolve to the existing article. Similarity uses case-folded three-word shingles and a deterministic 64-bit SimHash. A candidate is similar only when its Hamming distance is at most three and its word-count ratio is between 0.8 and 1.25 inclusive. Candidates are limited to the same user and require an explicit choice: open the existing article or save the preview as a new version linked to that article. No cross-user duplicate information is exposed.

## 8. Data Model

### 8.1 `article_imports`

- `id uuid primary key`
- `user_id uuid not null references users`
- `source_kind enum(url, paste, album, local_file, computer)`
- `status article_import_status not null`
- `source_url text null`
- `preview_title text null`
- `preview_text text null`
- `word_count integer null`
- `content_hash text null`
- `similarity_fingerprint bigint null`
- `failure_code text null`
- `failure_message_public text null`
- `article_id uuid null references imported_articles`
- `attempt_count integer not null default 0`
- `created_at`, `updated_at`, `processing_started_at`, `preview_ready_at`, `confirmed_at`, `expires_at` as UTC `timestamptz`

Indexes support `(user_id, created_at desc, id desc)`, status cleanup, and content-hash lookup. Shape checks ensure preview fields exist only in preview/confirmed states and public failure fields exist only for `retryable` or `failed` state. Unconfirmed previews expire seven days after creation; expiry clears their preview text and any remaining assets.

### 8.2 `import_assets`

- `id uuid primary key`
- `article_import_id uuid not null references article_imports on delete cascade`
- `position integer not null`
- `media_type text not null`
- `byte_size integer not null`
- `sha256 text not null`
- `content bytea not null`
- `created_at timestamptz not null`

`(article_import_id, position)` and `(article_import_id, sha256)` are unique. Rows are deleted in the same transaction that persists `preview_ready` or terminal failure. A cleanup sweep deletes orphaned assets older than 24 hours after validating import state and age.

### 8.3 `imported_articles`

- `id uuid primary key`
- `user_id uuid not null references users`
- `source_kind` matching the import source enum
- `source_url text null`
- `title text not null`
- `word_count integer not null`
- `content_hash text not null`
- `similarity_fingerprint bigint not null`
- `previous_version_id uuid null references imported_articles`
- `imported_at timestamptz not null`
- `created_at timestamptz not null`

`(user_id, content_hash)` is unique. The source URL is retained only for URL imports. The article body is stored only in ordered `article_paragraphs` rows.

### 8.4 `article_paragraphs`

- `id uuid primary key`
- `article_id uuid not null references imported_articles on delete cascade`
- `position integer not null`
- `plain_text text not null`

`(article_id, position)` is unique and position must be nonnegative.

### 8.5 `article_translations`

This table mirrors the proven translation lifecycle but references `imported_articles` and `article_paragraphs`. Its cache identity is `(article_id, scope, paragraph_id, source_hash) NULLS NOT DISTINCT`. It stores only a ready Chinese translation or a public terminal failure.

### 8.6 `computer_upload_sessions`

- `id uuid primary key`
- `user_id uuid not null references users`
- `article_import_id uuid not null unique references article_imports`
- `code_hash text not null unique`
- `capability_token_hash text null unique`
- `status enum(awaiting_code, claimed, uploaded, expired) not null`
- `expires_at`, `claimed_at`, `uploaded_at`, `created_at` as UTC `timestamptz`

The raw code and capability token are returned once and never persisted.

## 9. Jobs and Temporary Storage

The existing generic jobs table adds these kinds:

- `article_import`
- `article_translation`

The startup registry must refuse to run if any enqueueable job kind lacks both a handler and a permanent-failure hook. Import jobs use the existing lease renewal and owner checks. They have at most three total attempts and a five-minute resource deadline. Every external request is aborted on lease loss.

No extra object store is required. Source bytes within the declared 10 MB per-file and 30 MB aggregate limits are held temporarily in `import_assets` so a queued job survives API or worker restart. Assets are never returned by a read API. They are removed immediately after extraction succeeds, terminal failure, cancellation, or expiry; `retryable` imports may retain them only until the 24-hour asset TTL.

Pasted text is stored directly in the private import draft. URL jobs store only the URL before extraction. Computer and mobile file uploads share the same asset records.

## 10. Public API

Every `/v1` route requires the existing anonymous bearer identity unless explicitly marked as a browser capability route. Mutations require an `Idempotency-Key`.

Extend the stable idempotency operation union with `create_article_import`, `upload_import_text`, `start_article_import`, `edit_import_preview`, `confirm_article_import`, `retry_article_import`, `cancel_article_import`, `request_article_translation`, and `create_computer_upload_session`. Raw asset positions use the unique `(import_id, position)` plus server-computed digest instead of storing one idempotency record per upload chunk.

### 10.1 Import lifecycle

```text
POST   /v1/imports
PUT    /v1/imports/:id/source-text
PUT    /v1/imports/:id/assets/:position
POST   /v1/imports/:id/process
GET    /v1/imports/:id
PATCH  /v1/imports/:id/preview
POST   /v1/imports/:id/confirm
POST   /v1/imports/:id/retry
POST   /v1/imports/:id/cancel
```

`POST /v1/imports` accepts a strict discriminated union:

- `{ sourceKind: 'url', url }`
- `{ sourceKind: 'paste' }`
- `{ sourceKind: 'album', assets: AssetDescriptor[1..10] }`
- `{ sourceKind: 'local_file', assets: AssetDescriptor[1] }`

URL imports enqueue immediately. Paste and asset imports begin in `awaiting_upload`. Pasted text is sent as a bounded `text/plain; charset=utf-8` stream to `source-text`; successful deterministic validation atomically moves it to `preview_ready`, and it is never copied to `import_assets` or sent through AI. Each asset `PUT` uses a raw stream with an exact `Content-Length`; the server computes SHA-256 while reading. Retrying an identical position and server-computed digest is a replay; different bytes for an occupied position are a conflict. `process` succeeds only when every declared asset is present and the aggregate limit holds.

The import DTO exposes metadata, status, safe failure, polling delay, editable preview only in `preview_ready`, duplicate information limited to the current user, and confirmed article ID. It never exposes source bytes.

`confirm` accepts `{ similarityDecision?: 'open_existing' | 'save_new_version' }`. Exact duplicates always reuse the existing article. A similar candidate requires the explicit field. Confirmation writes article and paragraphs, links the import, and changes state in one transaction.

### 10.2 Computer upload

```text
POST /v1/computer-upload-sessions
GET  /v1/computer-upload-sessions/:id

GET  /computer-upload                 (public static form)
POST /computer-upload/claim           (public, rate-limited)
POST /computer-upload/file            (capability cookie, streamed)
```

The public form uses CSRF-resistant same-site POSTs, a strict Content Security Policy, `X-Content-Type-Options: nosniff`, no framing, and no reflected filename or article content. The server derives the upload origin from an explicit `PUBLIC_SERVER_ORIGIN` configuration value, never from forwarded host headers.

### 10.3 Articles and translation

```text
GET  /v1/articles/:id
POST /v1/articles/:id/translations
GET  /v1/article-translations/:id
```

Article reads are owner-only. Translation requests use the same `paragraph | full` distinction, cache behavior, polling contract, moderation, Han-character validation, and idempotency guarantees as generated-practice translation.

## 11. Client Design

### 11.1 Source routing

The feed replaces mock-only actions with typed source descriptors and an explicit callback:

- `link` → `/imports/new?source=url`
- `paste` → `/imports/new?source=paste`
- `album` → photo selection, then `/imports/new?source=album`
- `local` → document selection, then `/imports/new?source=local_file`
- `computer` → `/imports/computer`

The header import control opens a source-selection sheet using the same descriptors. It does not duplicate navigation logic.

### 11.2 Screens

```text
/imports/new
/imports/computer
/imports/[id]/processing
/imports/[id]/preview
/articles/[id]/read
```

`/imports/new` owns source-specific input and a common submission footer. It shows selected image order, a locally derived basename truncated to 120 display characters, size totals, permission state, and validation errors. Display names are never sent to logs.

`processing` polls only while the app is active, refreshes immediately on foreground, and routes by durable status. It preserves the active import ID in AsyncStorage and never creates a replacement import automatically.

`preview` shows editable title and body, current word count, source label, and duplicate choice when required. It keeps one idempotency key per edit or confirmation operation through retry.

`read` renders ordered text paragraphs as nested React Native text, not HTML. It supports paragraph and full translation using an article-specific hook and restores the latest paragraph position.

### 11.3 Native integrations

Install SDK 54-compatible versions through `expo install`:

- `expo-clipboard`
- `expo-image-picker`
- `expo-document-picker`
- `expo-image-manipulator`

Permission prompts occur only from explicit presses. Cancellation is a normal no-op, not an error. The app never stores the bearer credential outside SecureStore and never sends it to the computer browser.

### 11.4 First-use identity

Imports reuse the existing 14+ local confirmation and anonymous-registration contract. The age confirmation is factored into a shared boundary so practice creation and article import cannot diverge. Expo Web continues to render without SecureStore authentication; complete import workflows remain native-only except the capability-protected computer upload page.

## 12. EvoLink Vision Boundary

Add `EVOLINK_VISION_MODEL` with the default `deepseek-v4-flash-vision-exp` and `EVOLINK_VISION_TIMEOUT_MS` with the default `120000`. The client bundle must never contain either server variable or the API key.

The AI provider gains a narrow method:

```ts
interface OcrImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  base64: string;
  position: number;
}

extractArticleText(
  images: readonly OcrImage[],
  signal: AbortSignal,
): Promise<{ title: string | null; text: string }>;
```

The EvoLink implementation uses a user content array containing an OCR instruction and ordered `image_url` data URIs. Response parsing goes through a strict schema. It rejects blank output and does not accept model-supplied word counts, hashes, source URLs, or ownership fields.

The fake provider produces deterministic OCR text for tests. The real-provider smoke test uses a small synthetic image containing non-copyright test prose and prints only status, counts, model, and timing.

Official EvoLink references used for this design:

- <https://evolink.ai/blog/how-to-use-deepseek-v4-flash-vision-exp-api>
- <https://evolink.ai/changelog>

## 13. Error Contract

Add stable public codes without provider, parser, filesystem, SQL, URL-host, or article-text details:

- `IMPORT_UNSUPPORTED_TYPE`
- `IMPORT_TOO_LARGE`
- `IMPORT_CONTENT_INVALID`
- `IMPORT_NOT_ENGLISH`
- `IMPORT_FETCH_BLOCKED`
- `IMPORT_FETCH_FAILED`
- `IMPORT_PARSE_FAILED`
- `IMPORT_OCR_FAILED`
- `IMPORT_DEADLINE_EXCEEDED`
- `UPLOAD_SESSION_EXPIRED`
- `UPLOAD_SESSION_USED`
- `SIMILAR_ARTICLE_REQUIRES_DECISION`

Permission denial and picker cancellation are client-local outcomes. Network errors retain the current resource and idempotency key. Retryable extraction/OCR failures enter `retryable` and expose retry while retained assets remain inside their 24-hour TTL; validation and unsupported-type failures are terminal unless the user starts a new source selection.

No final failure creates an article. Failed or expired computer sessions cannot be revived.

## 14. Security and Privacy

- Add logger redaction for import request bodies, preview text, source URLs, filenames, upload codes, capability cookies, OCR payloads, and extracted text.
- Do not include source data in thrown errors, metrics labels, snapshots, or job failure details.
- Authenticate ownership inside each transaction, not only in route middleware.
- Validate UUIDs, idempotency keys, asset positions, lengths, digests, and state transitions before mutation.
- Keep the global JSON body limit at 32 KiB. Raw asset and pasted-text routes receive scoped streaming limits; the preview-edit JSON route alone receives a 128 KiB body limit so a valid 5,000-word article can be edited without raising limits elsewhere.
- Buffer at most one validated 10 MB asset at a time in an API request. Enforce the 30 MB aggregate in a locked transaction.
- Never invoke a shell command with a user filename or URL.
- Parse documents with network access and active content disabled.
- Strip image metadata before sending image bytes to EvoLink.
- Delete temporary assets on success, permanent failure, cancellation, expiry, and audited TTL cleanup.
- Keep imported content private to one user and do not use it for model training beyond the configured provider request needed for OCR or translation.
- Scan Expo source and export output for server variable names and configured secret values.

## 15. Configuration

Add these server-only variables to the schema and `.env.example`:

```text
PUBLIC_SERVER_ORIGIN=
EVOLINK_VISION_MODEL=deepseek-v4-flash-vision-exp
EVOLINK_VISION_TIMEOUT_MS=120000
IMPORT_MAX_TEXT_BYTES=131072
IMPORT_MAX_FILE_BYTES=10485760
IMPORT_MAX_TOTAL_BYTES=31457280
IMPORT_FETCH_MAX_BYTES=5242880
IMPORT_FETCH_TIMEOUT_MS=15000
IMPORT_JOB_DEADLINE_MS=300000
COMPUTER_UPLOAD_TTL_MS=600000
IMPORT_ASSET_TTL_MS=86400000
IMPORT_DRAFT_TTL_MS=604800000
```

`PUBLIC_SERVER_ORIGIN` has no default and must be an explicit absolute `http` development or `https` production origin. It may contain the current LAN IP locally. `EXPO_PUBLIC_API_BASE_URL` remains the only import-related client environment variable.

## 16. Test Strategy

### 16.1 Contracts and units

- strict DTOs reject extra fields, invalid states, excessive descriptors, and unsafe URLs;
- state transition table exhaustively covers allowed and forbidden edges;
- normalization, word counting, paragraph splitting, exact hash, and similarity fingerprint fixtures;
- magic-byte detection independent of extension;
- TXT, HTML, DOCX, text-PDF, empty-PDF, corrupted-file, and oversized fixtures;
- ordered image batching and fake OCR schema validation;
- URL allow/deny matrix for IPv4, IPv6, encoded hosts, redirects, credentials, DNS rebinding, and cloud metadata;
- upload-code normalization, entropy, hash, expiry, and constant-time token comparison.

All textual fixtures are original synthetic prose committed for testing. Binary fixtures are minimal generated documents without user content.

### 16.2 Database and API integration

- owner isolation for imports, assets, sessions, articles, and translations;
- concurrent identical idempotency keys create one resource;
- different bytes cannot replace an uploaded position;
- two workers cannot claim the same import;
- lease loss prevents preview or failure writes;
- retry from `retryable` reuses the import and its not-yet-expired assets;
- exact duplicate confirmation reuses one article;
- similar content requires an explicit decision;
- confirmation writes article and paragraphs atomically;
- success, permanent failure, cancellation, expiry, and TTL cleanup remove assets;
- computer code claim and upload are atomic, rate-limited, expiring, and single-use;
- article translation cache and retry behavior match the existing practice guarantees;
- migrations run twice and integration tests remain isolated to `app_test_*` schemas.

### 16.3 Client tests

- each feed and header action routes to the correct source flow;
- clipboard, photo, and document cancellation do not create imports;
- permission denial produces actionable UI;
- image order, removal, and size calculations are deterministic;
- uploads retain import IDs and idempotency keys through retry;
- polling pauses in background and resumes on foreground;
- every durable status routes correctly after remount;
- preview edits are validated and duplicate choices are explicit;
- article reading renders text safely and translation appears only after ready;
- API configuration and public error envelopes remain sanitized.

### 16.4 Acceptance

Run the full repository gate and build, a real Neon migration twice, a small real EvoLink OCR smoke, a client-export secret scan, and an Expo Go native walkthrough for all five paths. The computer path must be exercised from a separate browser using the displayed code. During one import, background and reopen the app and confirm it resumes the same import ID.

Acceptance fails if any control is visually pressable but has no complete action, if a failed import creates an article, if temporary bytes remain after terminal cleanup, or if a server secret enters the client bundle.

## 17. Delivery Sequence

The implementation plan should preserve vertical slices in this order:

1. contracts, schema, import state machine, and paste-to-preview-to-article tracer bullet;
2. article reading and article translation;
3. safe URL fetch and HTML extraction;
4. bounded asset protocol plus TXT/HTML/DOCX/PDF parsing;
5. photo selection, image normalization, and EvoLink OCR;
6. computer session and browser upload page;
7. feed/header wiring, resume UX, cleanup, security regression suite, and real acceptance.

Each slice must include its own tests and focused commit. Existing generated-practice behavior must stay green after every slice.

## 18. Completion Criteria

The feature is complete only when:

1. every visible import control has a real action and feedback;
2. all five sources can reach an editable preview with valid input;
3. confirmation creates one private article and ordered paragraphs;
4. imported article paragraph/full translation works and caches results;
5. imports resume after network interruption, backgrounding, or App restart;
6. URL fetch cannot reach private infrastructure or bypass checks through redirects/rebinding;
7. file limits, signatures, parsers, OCR, duplicate handling, ownership, and idempotency are tested;
8. computer codes expire, are rate-limited, and cannot be reused;
9. terminal paths and cleanup remove all temporary binary assets;
10. no current practice, quiz, quota, or evidence behavior regresses;
11. Expo Go completes all five native acceptance paths;
12. full automated checks, builds, migrations, live smoke, and secret scans pass.
