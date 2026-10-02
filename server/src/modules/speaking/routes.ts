import type { FastifyPluginAsync } from 'fastify';
import type { Readable } from 'node:stream';
import { z, type ZodType } from 'zod';
import {
  SPEAKING_MAX_SUBTITLE_BYTES, CreateSpeakingAssetRequestSchema, CreateSpeakingMaterialRequestSchema,
  ImportSpeakingSubtitlesRequestSchema, SaveSpeakingSessionRequestSchema, SpeakingCapabilitiesDtoSchema,
  SpeakingLibraryQuerySchema,
  SpeakingResourceIdSchema, UpdateSpeakingStateRequestSchema, UpdateSpeakingSubtitlesRequestSchema,
  CreateSpeakingPronunciationRequestSchema,
} from '@context-reader/contracts';
import { AppError } from '../../core/errors';
import type { ServerConfig } from '../../config/env';
import type { AppDatabase } from '../../db/client';
import { parseUuidParam, requireIdempotencyKey } from '../../http/validation';
import { FFmpegMediaProcessor } from '../../infrastructure/media/ffmpeg';
import type { MediaStore } from '../../infrastructure/media/store';
import type { PronunciationProvider } from '../../infrastructure/speech/speechace';
import { requireAuth } from '../auth/routes';
import { configuredSpeakingMediaStore, createSpeakingAsset, requireMediaStore, sweepSpeakingAssets, uploadSpeakingAsset } from './assets';
import { getPublicSpeakingCatalog, getPublicSpeakingMaterial, getPublicSpeakingPlayback, loadSpeakingCatalogData } from './catalog';
import { getSpeakingPlayback, serveSpeakingMedia, SpeakingPlaybackSigner } from './playback';
import { createSpeakingMaterial, getSpeakingLibrary, getSpeakingMaterial, getSpeakingState,
  importSpeakingSubtitles, saveSpeakingSession, updateSpeakingState, updateSpeakingSubtitles } from './service';
import { createSpeakingPronunciationAssessment, getSpeakingPronunciationAssessment } from './pronunciation';
import { pronunciationCapability } from './pronunciation-shared';

export interface SpeakingRoutesOptions {
  db: AppDatabase; config: ServerConfig; catalogPath: string;
  mediaStore?: MediaStore; mediaProcessor?: Pick<FFmpegMediaProcessor, 'probe'>;
  pronunciationProvider?: PronunciationProvider;
}
const jsonLimit = 2 * 1024 ** 2;

export const speakingRoutes: FastifyPluginAsync<SpeakingRoutesOptions> = async (app, options) => {
  const catalog = loadSpeakingCatalogData(options.catalogPath);
  const deps = { db: options.db, config: options.config,
    catalog: catalog.materials,
    mediaStore: options.mediaStore ?? configuredSpeakingMediaStore(options.config),
    mediaProcessor: options.mediaProcessor ?? new FFmpegMediaProcessor({ ffmpegPath: options.config.FFMPEG_PATH,
      ffprobePath: options.config.FFPROBE_PATH }),
    ...(options.pronunciationProvider ? { pronunciationProvider: options.pronunciationProvider } : {}),
  };
  const signer = new SpeakingPlaybackSigner(options.config.SPEAKING_PLAYBACK_SIGNING_KEY);
  const auth = requireAuth(options.db);
  const authenticated = { preHandler: auth };
  const json = { preHandler: auth, bodyLimit: jsonLimit };
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

  app.get('/v1/speaking/catalog', async () => getPublicSpeakingCatalog(catalog));
  app.get('/v1/speaking/catalog/:id', async request =>
    getPublicSpeakingMaterial(catalog, resourceId(request.params, 'id')));
  app.get('/v1/speaking/catalog/:id/playback', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    return getPublicSpeakingPlayback(catalog, deps.mediaStore, resourceId(request.params, 'id'));
  });

  app.get('/v1/speaking/capabilities', authenticated, async () => {
    const store = requireMediaStore(deps);
    return SpeakingCapabilitiesDtoSchema.parse({ storage: store.driver,
      maxMediaBytes: options.config.SPEAKING_MAX_MEDIA_BYTES,
      maxSubtitleBytes: SPEAKING_MAX_SUBTITLE_BYTES, autoSubtitles: false,
      pronunciation: pronunciationCapability(options.config.EVOLINK_API_KEY || (options.pronunciationProvider ? 'test-provider' : '')) });
  });
  app.post('/v1/speaking/pronunciation-assessments', json, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const result = await createSpeakingPronunciationAssessment(deps, request.authUser.userId,
      requireIdempotencyKey(request.headers['idempotency-key']), parseBody(CreateSpeakingPronunciationRequestSchema, request.body));
    return reply.status(result.status === 'processing' ? 202 : 200).send(result);
  });
  app.get('/v1/speaking/pronunciation-assessments/:id', authenticated, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return getSpeakingPronunciationAssessment(deps, request.authUser.userId, parseUuidParam(request.params, 'id', '评分编号格式无效'));
  });
  app.post('/v1/speaking/assets', authenticated, async (request, reply) => {
    const body = parseBody(CreateSpeakingAssetRequestSchema, request.body);
    const asset = await createSpeakingAsset(deps, request.authUser.userId,
      requireIdempotencyKey(request.headers['idempotency-key']), body);
    return reply.status(201).send(asset);
  });
  app.put('/v1/speaking/assets/:id/content', authenticated, async request => {
    if (!request.body || typeof (request.body as Readable).pipe !== 'function') {
      throw new AppError('IMPORT_UNSUPPORTED_TYPE', '请上传音视频二进制文件', 415);
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    request.raw.once('aborted', cancel);
    try {
      return await uploadSpeakingAsset(deps, request.authUser.userId,
        parseUuidParam(request.params, 'id', '媒体编号格式无效'), request.body as Readable,
        request.headers['content-type'] ?? '', request.headers['content-length'], abort.signal);
    } finally { request.raw.removeListener('aborted', cancel); }
  });
  app.get('/v1/speaking/assets/:id/playback', authenticated, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return getSpeakingPlayback(deps, signer, request.authUser.userId,
      parseUuidParam(request.params, 'id', '媒体编号格式无效'));
  });
  app.route({ method: ['GET', 'HEAD'], url: '/v1/speaking/assets/:id/play', handler: async (request, reply) =>
    serveSpeakingMedia(deps, signer, parseUuidParam(request.params, 'id', '媒体编号格式无效'), request, reply) });
  app.get('/v1/speaking/library', authenticated, async request => {
    const query = parseBody(SpeakingLibraryQuerySchema, request.query);
    return getSpeakingLibrary(deps, request.authUser.userId, query);
  });
  app.get('/v1/speaking/materials', authenticated, async request => {
    const library = await getSpeakingLibrary(deps, request.authUser.userId, parseBody(SpeakingLibraryQuerySchema, request.query));
    return { materials: library.materials, nextCursor: library.nextCursor };
  });
  app.post('/v1/speaking/materials', json, async (request, reply) => {
    const body = parseBody(CreateSpeakingMaterialRequestSchema, request.body);
    const material = await createSpeakingMaterial(deps, request.authUser.userId,
      requireIdempotencyKey(request.headers['idempotency-key']), body);
    return reply.status(201).send(material);
  });
  app.get('/v1/speaking/materials/:id', authenticated, async request =>
    getSpeakingMaterial(deps, request.authUser.userId, resourceId(request.params, 'id')));
  app.patch('/v1/speaking/materials/:id/subtitles', json, async request => {
    const body = parseBody(UpdateSpeakingSubtitlesRequestSchema, request.body);
    return updateSpeakingSubtitles(deps, request.authUser.userId, resourceId(request.params, 'id'),
      requireIdempotencyKey(request.headers['idempotency-key']), body);
  });
  app.post('/v1/speaking/materials/:id/subtitles/import', json, async request => {
    const body = parseBody(ImportSpeakingSubtitlesRequestSchema, request.body);
    return importSpeakingSubtitles(deps, request.authUser.userId, resourceId(request.params, 'id'),
      requireIdempotencyKey(request.headers['idempotency-key']), body);
  });
  app.get('/v1/speaking/materials/:id/state', authenticated, async request =>
    getSpeakingState(deps, request.authUser.userId, resourceId(request.params, 'id')));
  app.patch('/v1/speaking/materials/:id/state', json, async request => {
    const body = parseBody(UpdateSpeakingStateRequestSchema, request.body);
    return updateSpeakingState(deps, request.authUser.userId, resourceId(request.params, 'id'),
      requireIdempotencyKey(request.headers['idempotency-key']), body);
  });
  app.put('/v1/speaking/sessions/:clientId', authenticated, async request => {
    const body = parseBody(SaveSpeakingSessionRequestSchema, request.body);
    return saveSpeakingSession(deps, request.authUser.userId, resourceId(request.params, 'clientId'),
      requireIdempotencyKey(request.headers['idempotency-key']), body);
  });
  // 未绑定素材的上传资产到期清理；停止时等待本轮清理结束。
  let cleaning: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!cleaning) cleaning = sweepSpeakingAssets(deps).catch(() => {
      app.log.error({ errorType: 'SpeakingAssetCleanupError' }, '口语临时资产清理失败');
    }).finally(() => { cleaning = undefined; });
  }, 300_000);
  timer.unref();
  app.addHook('onClose', async () => { clearInterval(timer); await cleaning; });
};

function resourceId(params: unknown, key: string) {
  const value = z.object({ [key]: SpeakingResourceIdSchema }).safeParse(params);
  if (!value.success || !value.data[key]) throw new AppError('VALIDATION_ERROR', '口语资源编号格式无效', 400);
  return value.data[key];
}
function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请检查口语素材与字幕信息', 400);
  return parsed.data;
}
