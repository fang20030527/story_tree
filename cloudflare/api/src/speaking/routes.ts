import {
  CreateSpeakingMaterialRequestSchema, CreateSpeakingPronunciationRequestSchema,
  ImportSpeakingSubtitlesRequestSchema, SaveSpeakingSessionRequestSchema,
  SpeakingLibraryQuerySchema, SpeakingResourceIdSchema, UpdateSpeakingStateRequestSchema,
  UpdateSpeakingSubtitlesRequestSchema,
} from '@context-reader/contracts';
import type { ZodType } from 'zod';

import { AppError } from '../../../../server/src/core/errors';
import type { PronunciationProvider } from '../../../../server/src/infrastructure/speech/provider';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';
import {
  createSpeakingMaterial, getSpeakingLibrary, getSpeakingMaterial, getSpeakingState, importSpeakingSubtitles,
  requireSpeakingIdempotencyKey, saveSpeakingSession, updateSpeakingState, updateSpeakingSubtitles,
} from './data';
import { createSpeakingPronunciationAssessment, getSpeakingPronunciationAssessment } from './pronunciation';

const MAX_JSON_BYTES = 2 * 1024 ** 2;

async function body<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readJsonBody(request, MAX_JSON_BYTES));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请检查口语素材与字幕信息', 400);
  return parsed.data;
}
function resourceId(raw: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(raw); }
  catch { throw new AppError('VALIDATION_ERROR', '口语资源编号格式无效', 400); }
  const parsed = SpeakingResourceIdSchema.safeParse(decoded);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '口语资源编号格式无效', 400);
  return parsed.data;
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

export async function handleSpeakingRoute(request: Request, env: ApiEnv, userId: string,
  pronunciationProvider?: PronunciationProvider): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/v1/speaking/')) return null;
  if (path === '/v1/speaking/pronunciation-assessments' && request.method === 'POST') {
    const assessment = await createSpeakingPronunciationAssessment(env, userId, requireSpeakingIdempotencyKey(request),
      await body(request, CreateSpeakingPronunciationRequestSchema), pronunciationProvider);
    return json(assessment, assessment.status === 'processing' ? 202 : 200);
  }
  const assessment = path.match(/^\/v1\/speaking\/pronunciation-assessments\/([^/]+)$/u);
  if (assessment && request.method === 'GET') {
    return json(await getSpeakingPronunciationAssessment(env, userId, resourceId(assessment[1]!)));
  }
  if ((path === '/v1/speaking/library' || path === '/v1/speaking/materials') && request.method === 'GET') {
    const query = SpeakingLibraryQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) throw new AppError('VALIDATION_ERROR', '素材分页参数无效', 400);
    const library = await getSpeakingLibrary(env, userId, query.data);
    return path.endsWith('/library') ? json(library) : json({ materials: library.materials, nextCursor: library.nextCursor });
  }
  if (path === '/v1/speaking/materials' && request.method === 'POST') {
    const key = requireSpeakingIdempotencyKey(request);
    return json(await createSpeakingMaterial(env, userId, key, await body(request, CreateSpeakingMaterialRequestSchema)), 201);
  }
  const material = path.match(/^\/v1\/speaking\/materials\/([^/]+)$/u);
  if (material && request.method === 'GET') return json(await getSpeakingMaterial(env, userId, resourceId(material[1]!)));
  const subtitles = path.match(/^\/v1\/speaking\/materials\/([^/]+)\/subtitles(?:\/(import))?$/u);
  if (subtitles && (request.method === 'PATCH' && !subtitles[2] || request.method === 'POST' && subtitles[2])) {
    const id = resourceId(subtitles[1]!);
    const key = requireSpeakingIdempotencyKey(request);
    return subtitles[2] ? json(await importSpeakingSubtitles(env, userId, id, key, await body(request, ImportSpeakingSubtitlesRequestSchema))) :
      json(await updateSpeakingSubtitles(env, userId, id, key, await body(request, UpdateSpeakingSubtitlesRequestSchema)));
  }
  const state = path.match(/^\/v1\/speaking\/materials\/([^/]+)\/state$/u);
  if (state && request.method === 'GET') return json(await getSpeakingState(env, userId, resourceId(state[1]!)));
  if (state && request.method === 'PATCH') {
    return json(await updateSpeakingState(env, userId, resourceId(state[1]!), requireSpeakingIdempotencyKey(request),
      await body(request, UpdateSpeakingStateRequestSchema)));
  }
  const session = path.match(/^\/v1\/speaking\/sessions\/([^/]+)$/u);
  if (session && request.method === 'PUT') {
    return json(await saveSpeakingSession(env, userId, resourceId(session[1]!), requireSpeakingIdempotencyKey(request),
      await body(request, SaveSpeakingSessionRequestSchema)));
  }
  return null;
}
