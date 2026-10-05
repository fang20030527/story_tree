import { handleAuthRoute, requireAuth } from './auth';
import { handleArticleDeleteRoute } from './articles/delete';
import {
  handleComputerUploadBrowserRoute,
  handleComputerUploadSessionRoute,
} from './computer-upload/routes';
import {
  addCommonHeaders,
  assertAllowedOrigin,
  corsPreflight,
  publicError,
} from './core/http';
import { enforceRequestLimits } from './core/rate-limit';
import { isApiConfigured, type ApiEnv } from './env';
import { handlePublicEditorialRoute } from './editorial/public';
import { handleImportAssetRoute } from './imports/routes';
import { handleImportReadRoute } from './imports/read';
import { handleImportMutationRoute } from './imports/mutations';
import { handleImportPasteRoute } from './imports/paste';
import { handleImportConfirmRoute } from './imports/confirm';
import { handleImportCreateRoute } from './imports/create';
import { handleImportProcessRoute } from './imports/process';
import { handleJobQueue, handleJobScheduled, type JobQueueBatch } from './jobs/dispatcher';
import { handlePracticeReadRoute } from './practice/read';
import { handlePracticeCreateRoute } from './practice/create';
import { handlePracticeMutationRoute } from './practice/mutations';
import { handlePracticeRetryFailedRoute } from './practice/retry-failed';
import { handleReadRoute } from './read';
import { handleTranslationReadRoute } from './translation/read';
import { handleTranslationRequestRoute } from './translation/request';
import { handleSynchronousTranslationRoute } from './translation/sync';
import { handleVocabularyReadRoute } from './vocabulary/items';
import { handleVocabularyCreateRoute } from './vocabulary/create';
import { handleVocabularyManageRoute } from './vocabulary/manage';
import { handleVocabularyMasteryRoute } from './vocabulary/mastery';
import { handleVocabularyWordRoute } from './vocabulary/words';
import { sweepSpeakingAssets } from './speaking/assets';
import { handleSpeakingOnCpuBoundary } from './speaking/cpu';
import { handleMessageBottleRoute } from './message-bottles/routes';
import { handleAccountDeleteRoute } from './account/delete';
import { handleModerationRoute } from './admin/moderation';
import { handleAccountRoute } from './account/routes';

export { CpuBoundary } from './cpu/object';

interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function unavailable(requestId: string): Response {
  return Response.json({
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用，请稍后重试',
      requestId,
      retryable: true,
    },
  }, { status: 503 });
}

function notFound(requestId: string): Response {
  return Response.json({
    error: { code: 'NOT_FOUND', message: '资源不存在', requestId, retryable: false },
  }, { status: 404 });
}

async function ready(env: ApiEnv): Promise<boolean> {
  if (!isApiConfigured(env)) return false;
  try {
    await env.DB.prepare('SELECT id FROM users LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

async function dispatch(request: Request, env: ApiEnv, requestId: string): Promise<Response> {
  const computerUploadPage = await handleComputerUploadBrowserRoute(request, env, {
    articleImportEnabled: isApiConfigured(env),
  });
  if (computerUploadPage) return computerUploadPage;
  if (request.method === 'OPTIONS') return corsPreflight(request, env);
  assertAllowedOrigin(request, env);
  const pathname = new URL(request.url).pathname;
  if (pathname === '/health/live' || pathname === '/health/ready') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Response.json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '不支持此请求方式',
          requestId,
          retryable: false,
        },
      }, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    if (pathname === '/health/live') return Response.json({ status: 'ok' });
    return (await ready(env)) ? Response.json({ status: 'ok' }) : unavailable(requestId);
  }

  if (pathname !== '/v1' && !pathname.startsWith('/v1/')) return notFound(requestId);

  // The staging workers.dev address must not create fresh identities or jobs
  // before the final D1 snapshot and the complete API are ready for cutover.
  if (!isApiConfigured(env)) return unavailable(requestId);

  await enforceRequestLimits(request, env);
  const editorialResponse = await handlePublicEditorialRoute(request, env);
  if (editorialResponse) return editorialResponse;
  if (/^\/v1\/speaking\/catalog(?:\/[^/]+(?:\/playback)?)?$/u.test(pathname)) {
    return handleSpeakingOnCpuBoundary(request, env, null);
  }
  // The moderation console has its own secret instead of an installation token.
  const moderationResponse = await handleModerationRoute(request, env);
  if (moderationResponse) return moderationResponse;
  const authResponse = await handleAuthRoute(request, env);
  if (authResponse) return authResponse;

  const { userId } = await requireAuth(request, env);
  const messageBottleResponse = await handleMessageBottleRoute(request, env, userId);
  if (messageBottleResponse) return messageBottleResponse;
  const accountResponse = await handleAccountRoute(request, env, userId);
  if (accountResponse) return accountResponse;
  const accountDeleteResponse = await handleAccountDeleteRoute(request, env, userId);
  if (accountDeleteResponse) return accountDeleteResponse;
  if (pathname.startsWith('/v1/speaking/')) {
    return handleSpeakingOnCpuBoundary(request, env, userId);
  }
  const uploadSessionResponse = await handleComputerUploadSessionRoute(request, env, userId, {
    articleImportEnabled: true,
  });
  if (uploadSessionResponse) return uploadSessionResponse;
  const readResponse = await handleReadRoute(request, env, userId);
  if (readResponse) return readResponse;
  const articleDeleteResponse = await handleArticleDeleteRoute(request, env, userId);
  if (articleDeleteResponse) return articleDeleteResponse;
  const translationResponse = await handleTranslationReadRoute(request, env, userId);
  if (translationResponse) return translationResponse;
  const translationRequestResponse = await handleTranslationRequestRoute(request, env, userId);
  if (translationRequestResponse) return translationRequestResponse;
  const synchronousTranslationResponse = await handleSynchronousTranslationRoute(request, env, userId);
  if (synchronousTranslationResponse) return synchronousTranslationResponse;
  const practiceResponse = await handlePracticeReadRoute(request, env, userId);
  if (practiceResponse) return practiceResponse;
  const practiceCreateResponse = await handlePracticeCreateRoute(request, env, userId, {
    generationHandlerReady: true,
    scheduledRecoveryReady: true,
  });
  if (practiceCreateResponse) return practiceCreateResponse;
  const retryFailedResponse = await handlePracticeRetryFailedRoute(request, env, userId);
  if (retryFailedResponse) return retryFailedResponse;
  const practiceMutationResponse = await handlePracticeMutationRoute(request, env, userId);
  if (practiceMutationResponse) return practiceMutationResponse;
  const vocabularyResponse = await handleVocabularyReadRoute(request, env, userId);
  if (vocabularyResponse) return vocabularyResponse;
  const vocabularyCreateResponse = await handleVocabularyCreateRoute(request, env, userId);
  if (vocabularyCreateResponse) return vocabularyCreateResponse;
  const wordsResponse = await handleVocabularyWordRoute(request, env, userId);
  if (wordsResponse) return wordsResponse;
  const masteryResponse = await handleVocabularyMasteryRoute(request, env, userId);
  if (masteryResponse) return masteryResponse;
  const manageResponse = await handleVocabularyManageRoute(request, env, userId);
  if (manageResponse) return manageResponse;
  const importAssetResponse = await handleImportAssetRoute(request, env, userId);
  if (importAssetResponse) return importAssetResponse;
  const importPasteResponse = await handleImportPasteRoute(request, env, userId);
  if (importPasteResponse) return importPasteResponse;
  const importCreateResponse = await handleImportCreateRoute(request, env, userId);
  if (importCreateResponse) return importCreateResponse;
  const importProcessResponse = await handleImportProcessRoute(request, env, userId);
  if (importProcessResponse) return importProcessResponse;
  const importReadResponse = await handleImportReadRoute(request, env, userId);
  if (importReadResponse) return importReadResponse;
  const importMutationResponse = await handleImportMutationRoute(request, env, userId);
  if (importMutationResponse) return importMutationResponse;
  const importConfirmResponse = await handleImportConfirmRoute(request, env, userId);
  if (importConfirmResponse) return importConfirmResponse;
  // An unknown route is a permanent miss. A retryable 503 here made clients retry forever
  // and hid routes that were never ported (POST /v1/practices/:id/retry-failed).
  return notFound(requestId);
}

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    const requestId = crypto.randomUUID();
    let response: Response;
    try {
      response = await dispatch(request, env, requestId);
    } catch (error) {
      response = publicError(error, requestId);
    }
    return addCommonHeaders(response, request, env, requestId);
  },

  async queue(
    batch: JobQueueBatch,
    env: ApiEnv,
    _context: ExecutionContext,
  ): Promise<void> {
    void _context;
    await handleJobQueue(batch, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: ApiEnv,
    _context: ExecutionContext,
  ): Promise<void> {
    void _context;
    await handleJobScheduled(env);
    await sweepSpeakingAssets(env).catch(() => {
      console.error({ errorType: 'SpeakingAssetCleanupFailed' });
    });
  },
};
