import { randomBytes, randomUUID } from 'node:crypto';

import {
  AnonymousAuthResponseSchema,
  ArticleImportDtoSchema,
  ArticleTranslationDtoSchema,
  ComputerUploadSessionDtoSchema,
  CreatedComputerUploadSessionSchema,
  ImportedArticleDtoSchema,
  PublicErrorSchema,
  type ArticleImportDto,
  type ArticleTranslationDto,
  type ImportedArticleDto,
} from '@context-reader/contracts';
import { inArray } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import type { ZodType } from 'zod';

import { createDatabase } from '../src/db/client';
import { importAssets } from '../src/db/schema';

const MAX_POLL_MS = 360_000;
const CHINESE_CHARACTER = /[\u3400-\u9fff]/u;
const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const SOURCE_TEXT = {
  paste: [
    'Careful readers compare several independent clues before they accept a broad claim about public life.',
    'They preserve context, inspect uncertainty, and revise their conclusions when reliable evidence changes.',
  ],
  album: [
    'A patient observer records each stage of an experiment and keeps the original sequence clear for later review.',
    'That discipline helps another reader distinguish measured results from assumptions, summaries, and accidental omissions.',
  ],
  local_file: [
    'Local archives become more useful when notes explain where each observation began and how it was checked.',
    'A concise record can preserve nuance while still allowing future readers to challenge the reasoning responsibly.',
  ],
  computer: [
    'A desktop workflow can transfer a private draft without turning its temporary file into a permanent public object.',
    'Short lived credentials and explicit confirmation keep the handoff understandable, bounded, and easy to audit.',
  ],
} as const;

const sourceCases = [
  { kind: 'url' as const, url: 'https://www.rfc-editor.org/rfc/rfc2606.html' },
  { kind: 'paste' as const },
  { kind: 'album' as const },
  { kind: 'local_file' as const },
  { kind: 'computer' as const },
];

type SourceKind = (typeof sourceCases)[number]['kind'];

interface JsonRequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  method?: 'GET' | 'POST' | 'PATCH';
}

interface SmokeContext {
  apiBaseUrl: string;
  token: string;
}

interface SourceResult {
  article: ImportedArticleDto;
  articleImport: ArticleImportDto;
  kind: SourceKind;
}

interface SourceFailure {
  code: string;
  kind: SourceKind;
  state: string;
}

class LiveSmokeError extends Error {
  constructor(
    readonly state: string,
    readonly code: string,
  ) {
    super('Live smoke acceptance step failed');
    this.name = 'LiveSmokeError';
  }
}

function requireLiveOptIn(): void {
  if (process.env.RUN_IMPORT_LIVE_SMOKE !== '1') {
    throw new LiveSmokeError('disabled', 'IMPORT_LIVE_SMOKE_OPT_IN_REQUIRED');
  }
}

function resolveApiBaseUrl(): string {
  const candidate =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
  try {
    return new URL(candidate).toString().replace(/\/$/u, '');
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is invalid');
  }
}

async function requestJson<T>(
  context: SmokeContext,
  path: string,
  schema: ZodType<T>,
  options: JsonRequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Authorization: `Bearer ${context.token}` });
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }
  const response = await safeFetch(`${context.apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  return parseJsonResponse(response, schema);
}

async function requestRaw<T>(
  context: SmokeContext,
  path: string,
  schema: ZodType<T>,
  input: {
    bytes: Buffer;
    idempotencyKey?: string;
    mediaType: string;
  },
): Promise<T> {
  const headers = new Headers({
    Authorization: `Bearer ${context.token}`,
    'Content-Length': String(input.bytes.byteLength),
    'Content-Type': input.mediaType,
  });
  if (input.idempotencyKey) {
    headers.set('Idempotency-Key', input.idempotencyKey);
  }
  const response = await safeFetch(`${context.apiBaseUrl}${path}`, {
    method: 'PUT',
    headers,
    body: new Uint8Array(input.bytes),
  });
  return parseJsonResponse(response, schema);
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new LiveSmokeError('network_error', 'NETWORK_REQUEST_FAILED');
  }
}

async function parseJsonResponse<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Request returned non-JSON status=${response.status}`);
  }
  if (!response.ok) {
    const failure = PublicErrorSchema.safeParse(json);
    const code = failure.success
      ? failure.data.error.code
      : 'INVALID_ERROR_RESPONSE';
    throw new LiveSmokeError(`http_${response.status}`, code);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error('Request returned an invalid payload');
  return parsed.data;
}

function idempotencyKey(): string {
  return randomUUID();
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForImport(
  context: SmokeContext,
  importId: string,
): Promise<ArticleImportDto> {
  const deadlineAt = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadlineAt) {
    const articleImport = await requestJson(
      context,
      `/v1/imports/${encodeURIComponent(importId)}`,
      ArticleImportDtoSchema,
    );
    if (articleImport.status === 'preview_ready') return articleImport;
    if (
      articleImport.status === 'failed' ||
      articleImport.status === 'retryable' ||
      articleImport.status === 'expired' ||
      articleImport.status === 'cancelled'
    ) {
      if (articleImport.articleId !== null) {
        throw new Error('Terminal import failure unexpectedly references an article');
      }
      throw new LiveSmokeError(
        articleImport.status,
        articleImport.failure?.code ?? 'IMPORT_STOPPED_WITHOUT_CODE',
      );
    }
    if (articleImport.status === 'confirmed') {
      throw new Error('Import was confirmed before preview verification');
    }
    await pause(articleImport.pollAfterMs ?? 1_000);
  }
  throw new LiveSmokeError('timeout', 'IMPORT_POLL_TIMEOUT');
}

async function uploadRawAsset(
  context: SmokeContext,
  importId: string,
  position: number,
  mediaType: string,
  bytes: Buffer,
): Promise<ArticleImportDto> {
  return requestRaw(
    context,
    `/v1/imports/${encodeURIComponent(importId)}/assets/${position}`,
    ArticleImportDtoSchema,
    { bytes, mediaType },
  );
}

async function startImport(
  context: SmokeContext,
  importId: string,
): Promise<ArticleImportDto> {
  const key = idempotencyKey();
  const first = await requestJson(
    context,
    `/v1/imports/${encodeURIComponent(importId)}/process`,
    ArticleImportDtoSchema,
    { method: 'POST', body: {}, idempotencyKey: key },
  );
  const replay = await requestJson(
    context,
    `/v1/imports/${encodeURIComponent(importId)}/process`,
    ArticleImportDtoSchema,
    { method: 'POST', body: {}, idempotencyKey: key },
  );
  assertSameId(first.id, replay.id, 'Import processing replay');
  return first;
}

async function confirmPreview(
  context: SmokeContext,
  articleImport: ArticleImportDto,
): Promise<ArticleImportDto> {
  if (articleImport.status !== 'preview_ready' || !articleImport.preview) {
    throw new Error('Import preview was not ready for confirmation');
  }
  const body =
    articleImport.preview.duplicate.kind === 'similar'
      ? { similarityDecision: 'save_new_version' as const }
      : {};
  const key = idempotencyKey();
  const first = await requestJson(
    context,
    `/v1/imports/${encodeURIComponent(articleImport.id)}/confirm`,
    ArticleImportDtoSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  const replay = await requestJson(
    context,
    `/v1/imports/${encodeURIComponent(articleImport.id)}/confirm`,
    ArticleImportDtoSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  assertSameId(first.id, replay.id, 'Import confirmation replay');
  if (first.status !== 'confirmed' || !first.articleId) {
    throw new Error('Import confirmation did not return an article ID');
  }
  if (replay.articleId !== first.articleId) {
    throw new Error('Import confirmation replay changed its article ID');
  }
  return first;
}

async function waitForArticleTranslation(
  context: SmokeContext,
  initial: ArticleTranslationDto,
): Promise<ArticleTranslationDto> {
  if (initial.status === 'ready') return initial;
  if (initial.status === 'failed') {
    throw new LiveSmokeError(
      'failed',
      initial.failure?.code ?? 'ARTICLE_TRANSLATION_FAILED',
    );
  }
  const deadlineAt = Date.now() + MAX_POLL_MS;
  let current = initial;
  while (Date.now() < deadlineAt) {
    await pause(current.pollAfterMs ?? 1_000);
    current = await requestJson(
      context,
      `/v1/article-translations/${encodeURIComponent(current.id)}`,
      ArticleTranslationDtoSchema,
    );
    if (current.status === 'ready') return current;
    if (current.status === 'failed') {
      throw new LiveSmokeError(
        'failed',
        current.failure?.code ?? 'ARTICLE_TRANSLATION_FAILED',
      );
    }
  }
  throw new LiveSmokeError('timeout', 'ARTICLE_TRANSLATION_POLL_TIMEOUT');
}

async function createImport(
  context: SmokeContext,
  body: unknown,
): Promise<ArticleImportDto> {
  const key = idempotencyKey();
  const first = await requestJson(
    context,
    '/v1/imports',
    ArticleImportDtoSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  const replay = await requestJson(
    context,
    '/v1/imports',
    ArticleImportDtoSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  assertSameId(first.id, replay.id, 'Import creation replay');
  return first;
}

async function finishSource(
  context: SmokeContext,
  kind: SourceKind,
  preview: ArticleImportDto,
): Promise<SourceResult> {
  if (!preview.preview || preview.preview.wordCount < 20 || preview.preview.wordCount > 5_000) {
    throw new Error('Import preview word count was outside the accepted range');
  }
  const confirmed = await confirmPreview(context, preview);
  const article = await requestJson(
    context,
    `/v1/articles/${encodeURIComponent(confirmed.articleId!)}`,
    ImportedArticleDtoSchema,
  );
  assertArticle(article, confirmed);
  return { article, articleImport: confirmed, kind };
}

async function runUrlSource(context: SmokeContext): Promise<SourceResult> {
  const urlCase = sourceCases[0]!;
  const created = await createImport(context, {
    sourceKind: urlCase.kind,
    url: urlCase.url,
  });
  return finishSource(context, 'url', await waitForImport(context, created.id));
}

async function runPasteSource(context: SmokeContext): Promise<SourceResult> {
  const created = await createImport(context, { sourceKind: 'paste' });
  const bytes = Buffer.from(SOURCE_TEXT.paste.join('\n\n'), 'utf8');
  const preview = await requestRaw(
    context,
    `/v1/imports/${encodeURIComponent(created.id)}/source-text`,
    ArticleImportDtoSchema,
    {
      bytes,
      idempotencyKey: idempotencyKey(),
      mediaType: 'text/plain; charset=utf-8',
    },
  );
  return finishSource(context, 'paste', preview);
}

async function runAlbumSource(context: SmokeContext): Promise<SourceResult> {
  const images = await Promise.all(
    SOURCE_TEXT.album.map((paragraph) => renderTextImage(paragraph)),
  );
  const created = await createImport(context, {
    sourceKind: 'album',
    assets: images.map((bytes, position) => ({
      position,
      mediaType: 'image/png',
      byteSize: bytes.byteLength,
    })),
  });
  for (const [position, bytes] of images.entries()) {
    await uploadRawAsset(context, created.id, position, 'image/png', bytes);
  }
  await startImport(context, created.id);
  return finishSource(
    context,
    'album',
    await waitForImport(context, created.id),
  );
}

async function runLocalFileSource(
  context: SmokeContext,
): Promise<SourceResult> {
  const bytes = createDocxFixture(SOURCE_TEXT.local_file);
  const created = await createImport(context, {
    sourceKind: 'local_file',
    assets: [{ position: 0, mediaType: DOCX_MEDIA_TYPE, byteSize: bytes.byteLength }],
  });
  await uploadRawAsset(context, created.id, 0, DOCX_MEDIA_TYPE, bytes);
  await startImport(context, created.id);
  return finishSource(
    context,
    'local_file',
    await waitForImport(context, created.id),
  );
}

async function runComputerSource(
  context: SmokeContext,
): Promise<SourceResult> {
  const key = idempotencyKey();
  const created = await requestJson(
    context,
    '/v1/computer-upload-sessions',
    CreatedComputerUploadSessionSchema,
    { method: 'POST', body: {}, idempotencyKey: key },
  );
  const replay = await requestJson(
    context,
    '/v1/computer-upload-sessions',
    CreatedComputerUploadSessionSchema,
    { method: 'POST', body: {}, idempotencyKey: key },
  );
  assertSameId(created.sessionId, replay.sessionId, 'Computer session replay');
  assertSameId(created.importId, replay.importId, 'Computer import replay');

  const browserOrigin = new URL(created.uploadUrl).origin;
  const claim = await safeFetch(`${browserOrigin}/computer-upload/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: browserOrigin,
    },
    body: new URLSearchParams({ code: created.uploadCode }),
  });
  await claim.arrayBuffer();
  if (!claim.ok) throw new Error(`Computer claim failed status=${claim.status}`);
  assertBrowserSecurityHeaders(claim);
  const cookie = extractCapabilityCookie(claim.headers.get('set-cookie'));

  const form = new FormData();
  const bytes = Buffer.from(SOURCE_TEXT.computer.join('\n\n'), 'utf8');
  form.set(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'text/plain' }),
    'synthetic.txt',
  );
  const uploaded = await safeFetch(`${browserOrigin}/computer-upload/file`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: browserOrigin },
    body: form,
  });
  await uploaded.arrayBuffer();
  if (!uploaded.ok) {
    throw new Error(`Computer upload failed status=${uploaded.status}`);
  }
  assertBrowserSecurityHeaders(uploaded);

  const polled = await requestJson(
    context,
    `/v1/computer-upload-sessions/${encodeURIComponent(created.sessionId)}`,
    ComputerUploadSessionDtoSchema,
  );
  if (polled.importId !== created.importId || polled.status !== 'uploaded') {
    throw new Error('Phone poll did not observe the uploaded computer session');
  }
  return finishSource(
    context,
    'computer',
    await waitForImport(context, created.importId),
  );
}

async function requestArticleTranslation(
  context: SmokeContext,
  articleId: string,
  body: { scope: 'full' } | { scope: 'paragraph'; paragraphId: string },
): Promise<ArticleTranslationDto> {
  const key = idempotencyKey();
  const first = await requestJson(
    context,
    `/v1/articles/${encodeURIComponent(articleId)}/translations`,
    ArticleTranslationDtoSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  const replay = await requestJson(
    context,
    `/v1/articles/${encodeURIComponent(articleId)}/translations`,
    ArticleTranslationDtoSchema,
    { method: 'POST', body, idempotencyKey: key },
  );
  assertSameId(first.id, replay.id, 'Article translation replay');
  return waitForArticleTranslation(context, first);
}

function assertArticle(
  article: ImportedArticleDto,
  confirmed: ArticleImportDto,
): void {
  if (article.id !== confirmed.articleId) {
    throw new Error('Article read returned a different resource ID');
  }
  if (article.wordCount < 20 || article.wordCount > 5_000) {
    throw new Error('Article word count was outside the accepted range');
  }
  article.paragraphs.forEach((paragraph, position) => {
    if (paragraph.position !== position) {
      throw new Error('Article paragraphs were not returned in order');
    }
  });
}

function requireChineseTranslation(translation: ArticleTranslationDto): void {
  const text = translation.translatedTextZh?.trim();
  if (!text || !CHINESE_CHARACTER.test(text)) {
    throw new Error('Article translation did not contain Chinese text');
  }
}

function assertSameId(left: string, right: string, resource: string): void {
  if (left !== right) throw new Error(`${resource} changed its resource ID`);
}

function assertBrowserSecurityHeaders(response: Response): void {
  const expected = {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  } as const;
  for (const [name, value] of Object.entries(expected)) {
    if (response.headers.get(name) !== value) {
      throw new Error('Computer upload response omitted a security header');
    }
  }
  if (!response.headers.get('content-security-policy')?.includes("default-src 'none'")) {
    throw new Error('Computer upload response omitted its content policy');
  }
}

function extractCapabilityCookie(setCookie: string | null): string {
  const match = setCookie?.match(/(?:^|,\s*)cr_upload=([^;]+)/u);
  if (!match?.[1]) throw new Error('Computer claim omitted its capability cookie');
  return `cr_upload=${match[1]}`;
}

async function renderTextImage(paragraph: string): Promise<Buffer> {
  const lines = wrapWords(paragraph, 48);
  const text = lines
    .map(
      (line, index) =>
        `<text x="70" y="${110 + index * 58}" font-size="38" font-family="Arial, sans-serif" fill="#111827">${escapeXml(line)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#ffffff"/>${text}</svg>`;
  return sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
}

function wrapWords(text: string, maximumCharacters: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/u)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maximumCharacters && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function createDocxFixture(paragraphs: readonly string[]): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(relationships),
      'word/document.xml': strToU8(documentXml),
    }),
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

async function assertNoTemporaryAssets(importIds: string[]): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const database = createDatabase(databaseUrl);
  try {
    const remaining = await database.db
      .select({ id: importAssets.id })
      .from(importAssets)
      .where(inArray(importAssets.articleImportId, importIds));
    if (remaining.length !== 0) {
      throw new Error('Terminal imports retained temporary assets');
    }
  } finally {
    await database.close();
  }
}

function safeFailure(error: unknown): { code: string; state: string } {
  if (error instanceof LiveSmokeError) {
    return { code: error.code, state: error.state };
  }
  return { code: 'SMOKE_ASSERTION_FAILED', state: 'failed' };
}

async function runImportLiveSmoke(): Promise<boolean> {
  requireLiveOptIn();
  const startedAt = Date.now();
  const context: SmokeContext = {
    apiBaseUrl: resolveApiBaseUrl(),
    token: randomBytes(32).toString('hex'),
  };
  await requestJson(context, '/v1/auth/anonymous', AnonymousAuthResponseSchema, {
    method: 'POST',
    body: { ageConfirmed14Plus: true },
  });

  const sourceRunners: Array<{
    kind: SourceKind;
    run: () => Promise<SourceResult>;
  }> = [
    { kind: 'paste', run: () => runPasteSource(context) },
    { kind: 'album', run: () => runAlbumSource(context) },
    { kind: 'local_file', run: () => runLocalFileSource(context) },
    { kind: 'computer', run: () => runComputerSource(context) },
    { kind: 'url', run: () => runUrlSource(context) },
  ];
  const results: SourceResult[] = [];
  const failures: SourceFailure[] = [];
  for (const source of sourceRunners) {
    try {
      const result = await source.run();
      results.push(result);
      process.stdout.write(
        `source=${result.kind} importId=${result.articleImport.id} articleId=${result.article.id} state=${result.articleImport.status} words=${result.article.wordCount} paragraphs=${result.article.paragraphs.length}\n`,
      );
    } catch (error) {
      const failure = { kind: source.kind, ...safeFailure(error) };
      failures.push(failure);
      process.stdout.write(
        `source=${failure.kind} state=${failure.state} code=${failure.code}\n`,
      );
    }
  }

  const translationArticle = results.find(({ kind }) => kind === 'paste')?.article;
  const paragraph = translationArticle?.paragraphs[0];
  let failedSteps = failures.length;
  if (!translationArticle || !paragraph) {
    process.stdout.write(
      'translations state=skipped code=PASTE_SOURCE_UNAVAILABLE\n',
    );
  } else {
    try {
      const paragraphTranslation = await requestArticleTranslation(
        context,
        translationArticle.id,
        { scope: 'paragraph', paragraphId: paragraph.id },
      );
      const fullTranslation = await requestArticleTranslation(
        context,
        translationArticle.id,
        { scope: 'full' },
      );
      requireChineseTranslation(paragraphTranslation);
      requireChineseTranslation(fullTranslation);
      process.stdout.write(
        `translations paragraphId=${paragraphTranslation.id} fullId=${fullTranslation.id} states=${paragraphTranslation.status},${fullTranslation.status}\n`,
      );
    } catch (error) {
      const failure = safeFailure(error);
      failedSteps += 1;
      process.stdout.write(
        `translations state=${failure.state} code=${failure.code}\n`,
      );
    }
  }

  try {
    if (results.length > 0) {
      await assertNoTemporaryAssets(
        results.map(({ articleImport }) => articleImport.id),
      );
    }
    process.stdout.write(`assets state=cleared imports=${results.length}\n`);
  } catch (error) {
    const failure = safeFailure(error);
    failedSteps += 1;
    process.stdout.write(
      `assets state=${failure.state} code=${failure.code}\n`,
    );
  }

  process.stdout.write(
    `model=${process.env.EVOLINK_VISION_MODEL ?? 'deepseek-v4-flash-vision-exp'} elapsedMs=${Date.now() - startedAt}\n`,
  );
  process.stdout.write(
    `acceptance state=${failedSteps === 0 ? 'passed' : 'failed'} failures=${failedSteps}\n`,
  );
  return failedSteps === 0;
}

try {
  if (!(await runImportLiveSmoke())) process.exitCode = 1;
} catch (error) {
  const failure = safeFailure(error);
  process.stderr.write(`smoke state=${failure.state} code=${failure.code}\n`);
  process.exitCode = 1;
}
