import {
  abbreviatePartOfSpeech,
  SentenceTranslationDtoSchema,
  SentenceTranslationRequestSchema,
  WordTranslationDtoSchema,
  WordTranslationRequestSchema,
  WordTranslationResultSchema,
  type WordTranslationResult,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { extractJsonObject } from '../../../../server/src/infrastructure/ai/json';
import { normalizeTerm } from '../../../../server/src/modules/vocabulary/normalize';
import { validateTranslationText } from '../../../../server/src/modules/translation/validation';
import { evolinkProvider, generationDeadlineMs } from '../ai/provider';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';

interface SavedWord { sourceSentence: string | null }

function invalidWordLookup(): AppError {
  return new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
}

function normalizeWordLookup(raw: unknown): WordTranslationResult {
  if (raw && typeof raw === 'object') {
    const parsed = WordTranslationResultSchema.safeParse(raw);
    if (!parsed.success) throw invalidWordLookup();
    return parsed.data;
  }
  if (typeof raw !== 'string' || !raw.trim()) throw invalidWordLookup();
  const value = raw.trim();
  let extracted: Record<string, unknown> | undefined;
  try {
    extracted = extractJsonObject(value);
  } catch {
    // Legacy provider responses may be plain text.
  }
  if (extracted !== undefined) {
    const parsed = WordTranslationResultSchema.safeParse(extracted);
    if (!parsed.success) throw invalidWordLookup();
    return parsed.data;
  }
  const match = value.match(
    /^(名词|动词|形容词|副词|介词|连词|代词|冠词|数词|感叹词|短语|n\.?|v\.?|adj\.?|adv\.?|prep\.?)\s*(?:[：:|—-]\s*|\s+)(.+)$/iu,
  );
  return {
    partOfSpeech: match?.[1] ?? '词性未知',
    meaningZh: match?.[2] ?? value,
  };
}

export async function handleSynchronousTranslationRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const pathname = new URL(request.url).pathname;
  if (pathname === '/v1/sentence-translations') {
    const parsed = SentenceTranslationRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '句子不能为空且不能超过 10000 字符', 400);
    }
    const provider = evolinkProvider(env);
    const source = parsed.data.text;
    const translatedTextZh = validateTranslationText(
      await provider.translate(source, AbortSignal.timeout(generationDeadlineMs(env))), source,
    );
    return Response.json(SentenceTranslationDtoSchema.parse({ translatedTextZh }), {
      headers: { 'cache-control': 'no-store' },
    });
  }
  if (pathname !== '/v1/word-translations') return null;
  const parsed = WordTranslationRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '词语格式无效', 400);
  const provider = evolinkProvider(env);
  const raw = await provider.lookupWord(
    parsed.data.term, parsed.data.context, new AbortController().signal,
  );
  const lookup = normalizeWordLookup(raw);
  const meaningZh = validateTranslationText(lookup.meaningZh);
  if (meaningZh.length > 200) throw invalidWordLookup();
  const partOfSpeech = abbreviatePartOfSpeech(lookup.partOfSpeech);
  if (!partOfSpeech || partOfSpeech.length > 40) throw invalidWordLookup();
  const savedWord = await env.DB.prepare(`
    SELECT source_sentence AS sourceSentence FROM vocabulary_items
    WHERE user_id = ? AND normalized_term = ? AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC LIMIT 1
  `).bind(userId, normalizeTerm(parsed.data.term)).first<SavedWord>();
  return Response.json(WordTranslationDtoSchema.parse({
    ...lookup,
    term: parsed.data.term,
    partOfSpeech,
    meaningZh,
    savedSourceSentence: savedWord?.sourceSentence ?? null,
  }), { headers: { 'cache-control': 'no-store' } });
}
