import { UuidSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import {
  renderBrowserErrorPage,
  renderCodePage,
  renderDonePage,
  renderUploadPage,
  type BrowserErrorKind,
} from '../../../../server/src/modules/computer-upload/page';
import { parseBearerToken } from '../auth/token';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';
import { detectImportFile } from '../imports/convert';
import { hashUploadCode, normalizeUploadCode } from './code';
import { renderUnavailablePage } from './page';
import {
  assertUploadCapability,
  claimComputerUploadSession,
  consumeComputerUpload,
  createComputerUploadSession,
  getComputerUploadSessionForUser,
} from './service';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_FORM_BYTES = 10_485_760 + 65_536;
const MAX_CLAIM_BYTES = 512;
const FAILURE_WINDOW_MS = 600_000;
const MAX_FAILURES = 5;

const browserHeaders = {
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'content-type': 'text/html; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

interface FailureRow {
  key_hash: string;
  request_count: number;
  expires_at: string;
}

export interface ComputerUploadRouteOptions {
  /** Keep false until an article_import queue handler can finish every new job. */
  articleImportEnabled?: boolean;
  /** Public API origin used in newly created and replayed upload links. */
  publicOrigin?: string;
}

function unavailable(): AppError {
  return new AppError('AI_UNAVAILABLE', '文章导入服务暂时不可用', 503, true);
}

function invalidCode(): AppError {
  return new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
}

function invalidMultipart(): AppError {
  return new AppError('IMPORT_CONTENT_INVALID', '上传文件无效', 422);
}

function browserPage(html: string, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(browserHeaders);
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(html, { status, headers });
}

function browserErrorKind(error: unknown): BrowserErrorKind {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'RATE_LIMITED': return 'too_many_attempts';
    case 'IMPORT_TOO_LARGE': return 'too_large';
    case 'IMPORT_UNSUPPORTED_TYPE':
    case 'IMPORT_CONTENT_INVALID':
    case 'IMPORT_PARSE_FAILED': return 'unsupported';
    case 'UPLOAD_SESSION_USED': return 'already_used';
    default: return 'invalid_or_expired';
  }
}

function browserFailure(error: unknown): Response {
  const candidate = error as { code?: unknown; statusCode?: unknown } | null;
  if (candidate?.code === 'AI_UNAVAILABLE') {
    return browserPage(renderUnavailablePage(), 503);
  }
  const status = typeof candidate?.statusCode === 'number' &&
    candidate.statusCode >= 400 && candidate.statusCode <= 599
    ? candidate.statusCode : 500;
  return browserPage(renderBrowserErrorPage(browserErrorKind(error)), status);
}

function assertBrowserPostOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let canonicalOrigin: string;
    try {
      canonicalOrigin = new URL(origin).origin;
    } catch {
      throw new AppError('VALIDATION_ERROR', '请求来源无效', 403);
    }
    if (canonicalOrigin !== new URL(request.url).origin) {
      throw new AppError('VALIDATION_ERROR', '请求来源无效', 403);
    }
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'none' && fetchSite !== 'same-origin') {
    throw new AppError('VALIDATION_ERROR', '请求来源无效', 403);
  }
}

async function readBoundedBody(request: Request, maximum: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length !== null && /^\d+$/u.test(length) && Number(length) > maximum) {
    throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalidMultipart();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const content = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return content;
}

async function claimCodeFromForm(request: Request): Promise<string> {
  if (!/^application\/x-www-form-urlencoded(?:\s*;|\s*$)/iu
    .test(request.headers.get('content-type') ?? '')) throw invalidCode();
  const bytes = await readBoundedBody(request, MAX_CLAIM_BYTES);
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw invalidCode();
  }
  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== 'code' ||
      entries[0][1].length > 32) throw invalidCode();
  return entries[0][1];
}

async function uploadFileFromForm(request: Request): Promise<{
  bytes: Uint8Array;
  mediaType: string;
}> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/iu.test(contentType) ||
      !/(?:^|;)\s*boundary=/iu.test(contentType)) throw invalidMultipart();
  const body = await readBoundedBody(request, MAX_FORM_BYTES);
  let form: FormData;
  try {
    form = await new Response(new Blob([new Uint8Array(body)]), {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw invalidMultipart();
  }
  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== 'file' ||
      !(entries[0][1] instanceof File)) throw invalidMultipart();
  const file = entries[0][1];
  if (file.size < 1 || file.size > 10_485_760) {
    throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = file.type || 'application/octet-stream';
  await detectImportFile(bytes, mediaType);
  return { bytes, mediaType };
}

function uploadCookie(request: Request): string {
  const values = [...(request.headers.get('cookie') ?? '')
    .matchAll(/(?:^|;\s*)cr_upload=([^;]*)/gu)];
  const token = values.length === 1 ? values[0]?.[1] : undefined;
  if (!token || !CAPABILITY_PATTERN.test(token)) {
    throw new AppError('UPLOAD_SESSION_USED', '上传会话已被使用', 410);
  }
  return token;
}

async function failureKey(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`computer-claim:${subject}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function assertAttemptsAllowed(env: ApiEnv, keys: readonly string[]): Promise<void> {
  const hashes = await Promise.all(keys.map(failureKey));
  for (const hash of hashes) {
    const row = await env.DB.prepare(`
      SELECT key_hash, request_count, expires_at FROM api_rate_limits
      WHERE key_hash = ? LIMIT 1
    `).bind(hash).first<FailureRow>();
    if (row && Date.parse(row.expires_at) > Date.now() &&
        row.request_count >= MAX_FAILURES) {
      throw new AppError('RATE_LIMITED', '尝试次数过多，请稍后再试', 429, true);
    }
  }
}

async function recordFailedAttempt(env: ApiEnv, keys: readonly string[]): Promise<void> {
  const hashes = await Promise.all(keys.map(failureKey));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + FAILURE_WINDOW_MS).toISOString();
  await env.DB.batch(hashes.map((hash) => env.DB.prepare(`
    INSERT INTO api_rate_limits(key_hash, window_started_at, request_count, expires_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      window_started_at = CASE WHEN expires_at <= excluded.window_started_at
        THEN excluded.window_started_at ELSE window_started_at END,
      request_count = CASE WHEN expires_at <= excluded.window_started_at
        THEN 1 ELSE request_count + 1 END,
      expires_at = CASE WHEN expires_at <= excluded.window_started_at
        THEN excluded.expires_at ELSE expires_at END
  `).bind(hash, now.toISOString(), expiresAt)));
}

async function claimFromBrowser(request: Request, env: ApiEnv): Promise<Response> {
  const ipKey = `ip:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`;
  let code: string;
  try {
    code = normalizeUploadCode(await claimCodeFromForm(request));
  } catch (error) {
    await assertAttemptsAllowed(env, [ipKey]);
    await recordFailedAttempt(env, [ipKey]);
    throw error;
  }
  const codeHash = await hashUploadCode(code);
  const keys = [ipKey, `code:${codeHash}`];
  await assertAttemptsAllowed(env, keys);
  let claimed: Awaited<ReturnType<typeof claimComputerUploadSession>>;
  try {
    claimed = await claimComputerUploadSession(env, code);
  } catch (error) {
    const appError = error as { code?: unknown } | null;
    if (appError?.code === 'UPLOAD_SESSION_USED' ||
        appError?.code === 'UPLOAD_SESSION_EXPIRED') {
      await recordFailedAttempt(env, keys);
    }
    throw error;
  }
  const cookie = [
    `cr_upload=${claimed.capabilityToken}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/computer-upload',
    `Expires=${claimed.expiresAt.toUTCString()}`,
    ...(new URL(request.url).protocol === 'https:' ? ['Secure'] : []),
  ].join('; ');
  return browserPage(renderUploadPage(), 200, { 'set-cookie': cookie });
}

async function uploadFromBrowser(request: Request, env: ApiEnv): Promise<Response> {
  const capabilityToken = uploadCookie(request);
  // Authorization precedes parsing or buffering the potentially large body.
  const session = await assertUploadCapability(env, capabilityToken);
  const file = await uploadFileFromForm(request);
  await consumeComputerUpload(env, session, capabilityToken, file.bytes, file.mediaType);
  return browserPage(renderDonePage(), 200, {
    'set-cookie': 'cr_upload=; HttpOnly; SameSite=Strict; Path=/computer-upload; Max-Age=0',
  });
}

/** The caller must dispatch this before the authenticated /v1 router. */
export async function handleComputerUploadBrowserRoute(
  request: Request,
  env: ApiEnv,
  options: ComputerUploadRouteOptions = {},
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/computer-upload' && request.method === 'GET') {
    return options.articleImportEnabled
      ? browserPage(renderCodePage())
      : browserPage(renderUnavailablePage(), 503);
  }
  if (request.method !== 'POST' ||
      (path !== '/computer-upload/claim' && path !== '/computer-upload/file')) return null;
  try {
    assertBrowserPostOrigin(request);
    if (!options.articleImportEnabled) throw unavailable();
    return path === '/computer-upload/claim'
      ? await claimFromBrowser(request, env)
      : await uploadFromBrowser(request, env);
  } catch (error) {
    return browserFailure(error);
  }
}

/** The caller must authenticate first and pass the resolved user ID. */
export async function handleComputerUploadSessionRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
  options: ComputerUploadRouteOptions = {},
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === 'POST' && path === '/v1/computer-upload-sessions') {
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
    }
    const body = request.body === null || request.headers.get('content-length') === '0'
      ? {} : await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 0) {
      throw new AppError('VALIDATION_ERROR', '请检查输入内容', 400);
    }
    const installationToken = parseBearerToken(request.headers.get('authorization'));
    const publicOrigin = options.publicOrigin
      ? new URL(options.publicOrigin).origin : new URL(request.url).origin;
    const created = await createComputerUploadSession(env, {
      userId, installationToken, idempotencyKey, publicOrigin,
      allowNew: options.articleImportEnabled === true,
    });
    return Response.json(created, { status: 201, headers: { 'cache-control': 'no-store' } });
  }
  if (request.method === 'GET') {
    const match = /^\/v1\/computer-upload-sessions\/([^/]+)$/u.exec(path);
    if (!match) return null;
    const sessionId = match[1]!;
    if (!UuidSchema.safeParse(sessionId).success) {
      throw new AppError('VALIDATION_ERROR', '上传会话编号格式无效', 400);
    }
    const session = await getComputerUploadSessionForUser(request, env, userId, sessionId);
    return Response.json(session, { headers: { 'cache-control': 'no-store' } });
  }
  return null;
}
