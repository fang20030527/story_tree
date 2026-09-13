import {
  TranslationDtoSchema,
  TranslationRequestSchema,
  WordTranslationDtoSchema,
  WordTranslationResultSchema,
  WordTranslationRequestSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { extractJsonObject } from '../../infrastructure/ai/json';
import type { AiProvider } from '../../infrastructure/ai/types';
import { parseUuidParam, requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import { getTranslationForUser, requestTranslation } from './service';
import { validateTranslationText } from './validation';

export interface TranslationRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
  wordProvider?: Pick<AiProvider, 'lookupWord'>;
}

export const translationRoutes: FastifyPluginAsync<
  TranslationRoutesOptions
> = async (app, options) => {
  app.post(
    '/v1/word-translations',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const parsed = WordTranslationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '词语格式无效', 400);
      }
      if (!options.wordProvider) {
        throw new AppError('AI_UNAVAILABLE', '翻译服务暂时不可用', 503, true);
      }
      const rawLookup = await options.wordProvider.lookupWord(
        parsed.data.term,
        parsed.data.context,
        new AbortController().signal,
      );
      const lookup = normalizeWordLookup(rawLookup);
      const meaningZh = validateTranslationText(lookup.meaningZh);
      if (meaningZh.length > 200) {
        throw new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
      }
      const partOfSpeech = lookup.partOfSpeech.trim();
      if (!partOfSpeech || partOfSpeech.length > 40) {
        throw invalidWordLookupOutput();
      }
      return reply.send(
        WordTranslationDtoSchema.parse({
          term: parsed.data.term,
          partOfSpeech,
          meaningZh,
        }),
      );
    },
  );

  app.post(
    '/v1/practices/:id/translations',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const practiceId = parseUuidParam(request.params, 'id', '练习编号格式无效');
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = TranslationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '翻译范围格式无效', 400);
      }

      const translation = await requestTranslation(options.db, {
        userId: request.authUser.userId,
        practiceId,
        request: parsed.data,
        idempotencyKey,
        deadlineMs: options.config.generationDeadlineMs,
      });
      return reply
        .status(translation.status === 'ready' ? 200 : 202)
        .send(TranslationDtoSchema.parse(translation));
    },
  );

  app.get(
    '/v1/translations/:id',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const translationId = parseUuidParam(
        request.params,
        'id',
        '翻译编号格式无效',
      );
      const translation = await getTranslationForUser(options.db, {
        userId: request.authUser.userId,
        translationId,
      });
      return reply.send(TranslationDtoSchema.parse(translation));
    },
  );
};

interface NormalizedWordLookup {
  partOfSpeech: string;
  meaningZh: string;
}

/**
 * Parse the structured dictionary response and tolerate the old plain-text
 * provider output during rollout. Structured output remains the preferred
 * path; legacy text receives an explicit fallback label so the client still
 * gets a renderable dictionary card instead of an opaque schema error.
 */
function normalizeWordLookup(raw: unknown): NormalizedWordLookup {
  if (typeof raw === 'object' && raw !== null) {
    const parsed = WordTranslationResultSchema.safeParse(raw);
    if (!parsed.success) throw invalidWordLookupOutput();
    return {
      partOfSpeech: parsed.data.partOfSpeech,
      meaningZh: parsed.data.meaningZh,
    };
  }

  if (typeof raw !== 'string') throw invalidWordLookupOutput();
  const trimmed = raw.trim();
  if (!trimmed) throw invalidWordLookupOutput();

  const candidate = tryExtractJsonObject(trimmed);
  if (candidate !== undefined) {
    const parsed = WordTranslationResultSchema.safeParse(candidate);
    if (!parsed.success) throw invalidWordLookupOutput();
    return {
      partOfSpeech: parsed.data.partOfSpeech,
      meaningZh: parsed.data.meaningZh,
    };
  }

  return parseLegacyWordLookup(trimmed);
}

function tryExtractJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    return extractJsonObject(value);
  } catch {
    return undefined;
  }
}

function parseLegacyWordLookup(value: string): NormalizedWordLookup {
  const match = value.match(
    /^(名词|动词|形容词|副词|介词|连词|代词|冠词|数词|感叹词|短语|n\.?|v\.?|adj\.?|adv\.?|prep\.?)\s*(?:[：:|—-]\s*|\s+)(.+)$/iu,
  );
  if (!match) {
    return { partOfSpeech: '词性未知', meaningZh: value };
  }
  return {
    partOfSpeech: match[1] ?? '词性未知',
    meaningZh: match[2] ?? value,
  };
}

function invalidWordLookupOutput(): AppError {
  return new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
}
