import {
  SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES,
  SPEAKING_PRONUNCIATION_MAX_DURATION_MS,
  SpeakingPronunciationLocaleSchema,
  SpeakingPronunciationReferenceSchema,
  SpeakingPronunciationResultSchema,
  type SpeakingPronunciationLocale,
  type SpeakingPronunciationResult,
} from '@context-reader/contracts';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import type { PronunciationProvider } from './provider';

export type SpeechaceRegion = 'us-west' | 'ap-southeast' | 'eu-west' | 'ap-south';

export type { PronunciationProvider } from './provider';

const endpoints: Record<SpeechaceRegion, string> = {
  'us-west': 'https://api.speechace.co',
  'ap-southeast': 'https://api2.speechace.com',
  'eu-west': 'https://api4.speechace.com',
  'ap-south': 'https://api5.speechace.com',
};
const MAX_RESPONSE_BYTES = 1024 ** 2;

const audioExtensions: Record<string, string> = {
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a',
  'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
  'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav', 'audio/vnd.wave': 'wav',
  'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff',
};

const ScoreSchema = z.number().finite().min(0).max(100);
const OptionalScoreSchema = ScoreSchema.nullable().optional();
const ExtentSchema = z.tuple([
  z.number().finite().nonnegative().max(SPEAKING_PRONUNCIATION_MAX_DURATION_MS / 10),
  z.number().finite().nonnegative().max(SPEAKING_PRONUNCIATION_MAX_DURATION_MS / 10),
]).refine(([start, end]) => end >= start).nullable().optional();
const PhoneSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  sound_most_like: z.string().trim().min(1).max(32).nullable().optional(),
  quality_score: OptionalScoreSchema,
  stress_score: OptionalScoreSchema,
  stress_level: z.number().int().min(0).max(2).nullable().optional(),
  extent: ExtentSchema,
}).passthrough();
const WordSchema = z.object({
  word: z.string().trim().min(1).max(200),
  quality_score: OptionalScoreSchema,
  phone_score_list: z.array(PhoneSchema).max(100).optional(),
}).passthrough();
const SuccessSchema = z.object({
  status: z.literal('success'),
  text_score: z.object({
    quality_score: OptionalScoreSchema,
    speechace_score: z.object({ pronunciation: ScoreSchema }).passthrough().optional(),
    word_score_list: z.array(WordSchema).min(1).max(250),
  }).passthrough(),
}).passthrough();
const ErrorSchema = z.object({
  status: z.literal('error'), short_message: z.string().optional(),
}).passthrough();

// 官方 ARPABET → IPA 表；英式特有的元音在 ipaSymbol 中覆盖。
const ipa: Record<string, string> = {
  aa: 'ɑ', ae: 'æ', ah: 'ʌ', ao: 'ɔ', aw: 'aʊ', ay: 'aɪ', b: 'b', ch: 'tʃ',
  d: 'd', dh: 'ð', eh: 'ɛ', er: 'ɚ', ey: 'eɪ', f: 'f', g: 'g', hh: 'h',
  ih: 'ɪ', iy: 'i', jh: 'dʒ', k: 'k', l: 'l', m: 'm', n: 'n', ng: 'ŋ',
  ow: 'oʊ', oy: 'ɔɪ', p: 'p', r: 'r', s: 's', sh: 'ʃ', t: 't', th: 'θ',
  uh: 'ʊ', uw: 'u', v: 'v', w: 'w', y: 'j', z: 'z', zh: 'ʒ',
};
const britishIpa: Record<string, string> = {
  aa: 'ɑː', ao: 'ɔː', ax: 'ə', ea: 'eə', eh: 'e', er: 'ɜː', ia: 'ɪə',
  iy: 'iː', oh: 'ɒ', ow: 'əʊ', ua: 'ʊə', uw: 'uː',
};

export class SpeechaceProvider implements PronunciationProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: {
    apiKey: string;
    region?: SpeechaceRegion;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
  }) {
    const region = config.region ?? 'ap-southeast';
    const timeoutMs = config.timeoutMs ?? 20_000;
    if (!config.apiKey.trim() || !Object.hasOwn(endpoints, region) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw notConfigured();
    }
    this.endpoint = endpoints[region];
    this.apiKey = config.apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async assess(input: Parameters<PronunciationProvider['assess']>[0]): Promise<SpeakingPronunciationResult> {
    const contentType = input.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    const extension = Object.hasOwn(audioExtensions, contentType) ? audioExtensions[contentType] : undefined;
    const reference = SpeakingPronunciationReferenceSchema.safeParse(input.referenceText);
    const locale = SpeakingPronunciationLocaleSchema.safeParse(input.locale);
    if (!extension || !reference.success || !locale.success || input.audio.byteLength === 0 ||
      input.audio.byteLength > SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES) {
      throw invalidAudio();
    }

    const url = new URL('/api/scoring/text/v9/json', this.endpoint);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('dialect', locale.data);
    const form = new FormData();
    form.set('text', reference.data);
    form.set('no_mc', '1');
    form.set('user_audio_file', new Blob([new Uint8Array(input.audio)], { type: contentType }), `recording.${extension}`);

    // 同时限制 fetch 和响应读取；即使注入的 fetch 忽略 AbortSignal，也不会无限等待。
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(unavailable(true));
        controller.abort();
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([
        this.request(url.toString(), form, locale.data, controller.signal),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(url: string, form: FormData, locale: SpeakingPronunciationLocale,
    signal: AbortSignal): Promise<SpeakingPronunciationResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: 'POST', body: form, signal, redirect: 'error' });
    } catch {
      throw unavailable(true);
    }
    if (response.status === 401 || response.status === 403) throw notConfigured();
    if (response.status === 429) throw limitReached();
    if (response.status === 408 || response.status >= 500) throw unavailable(true);

    let body: unknown;
    try {
      body = await readJsonResponse(response, signal);
    } catch {
      if (signal.aborted) throw unavailable(true);
      throw response.ok ? invalidResult() : unavailable(false);
    }
    const error = ErrorSchema.safeParse(body);
    if (error.success) throw upstreamError(error.data.short_message);
    if (!response.ok) throw unavailable(false);
    return normalizeResult(body, locale);
  }
}

async function readJsonResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentLength = response.headers.get('content-length')?.trim();
  if (signal.aborted || (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw signal.aborted ? unavailable(true) : invalidResult();
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidResult();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let byteSize = 0;
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw unavailable(true);
      if (done) break;
      byteSize += value.byteLength;
      if (byteSize > MAX_RESPONSE_BYTES) throw invalidResult();
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function normalizeResult(body: unknown, locale: SpeakingPronunciationLocale): SpeakingPronunciationResult {
  const parsed = SuccessSchema.safeParse(body);
  if (!parsed.success) throw invalidResult();
  const textScore = parsed.data.text_score;
  const score = textScore.speechace_score?.pronunciation ?? textScore.quality_score;
  if (score === null || score === undefined) throw invalidResult();
  const words: SpeakingPronunciationResult['words'] = textScore.word_score_list.map(word => {
    const phones = word.phone_score_list ?? [];
    const phonemes = phones.map(phone => ({
      symbol: ipaSymbol(phone.phone, locale, phone.stress_level),
      spokenSymbol: phone.sound_most_like ? ipaSymbol(phone.sound_most_like, locale,
        phone.sound_most_like.toLowerCase() === phone.phone.toLowerCase() ? phone.stress_level : undefined) : null,
      score: phone.quality_score ?? null,
      stressScore: phone.stress_score ?? null,
      // extent 是 10 毫秒单位；word_extent 是字母位置，不能当作音频时间。
      startMs: phone.extent ? phone.extent[0] * 10 : null,
      endMs: phone.extent ? phone.extent[1] * 10 : null,
    }));
    return {
      word: word.word, score: word.quality_score ?? null,
      startMs: phonemes[0]?.startMs ?? null,
      endMs: phonemes.at(-1)?.endMs ?? null,
      phonemes,
    };
  });
  const result = SpeakingPronunciationResultSchema.safeParse({ score, words, feedback: feedbackFor(words) });
  if (!result.success) throw invalidResult();
  return result.data;
}

function ipaSymbol(phone: string, locale: SpeakingPronunciationLocale, stress?: number | null): string {
  const code = phone.toLowerCase();
  const base = code.replace(/[012]$/u, '');
  if (base === 'ah' && (code.endsWith('0') || (!/[12]$/u.test(code) && stress === 0))) return 'ə';
  const british = locale === 'en-gb' && Object.hasOwn(britishIpa, base) ? britishIpa[base] : undefined;
  return british ?? (Object.hasOwn(ipa, base) ? ipa[base] : undefined) ?? phone;
}

function feedbackFor(words: SpeakingPronunciationResult['words']): string[] {
  const feedback: string[] = [];
  const targets = words.filter(word =>
    (word.score !== null && word.score < 80) || word.phonemes.some(phone =>
      (phone.score !== null && phone.score < 80) || (phone.stressScore !== null && phone.stressScore < 80)))
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100));
  for (const word of targets) {
    const phone = word.phonemes.filter(value => value.score !== null && value.score < 80)
      .sort((a, b) => a.score! - b.score!)[0];
    if (phone) {
      const soundedDifferent = phone.spokenSymbol && phone.spokenSymbol !== phone.symbol &&
        !['sil', 'spn'].includes(phone.spokenSymbol);
      feedback.push(soundedDifferent
        ? `「${word.word}」中的 /${phone.symbol}/ 更接近 /${phone.spokenSymbol}/，请听示范后重点练习 /${phone.symbol}/。`
        : `请重点练习「${word.word}」中的 /${phone.symbol}/，听清示范后放慢重读。`);
    } else if (word.phonemes.some(value => value.stressScore !== null && value.stressScore < 80)) {
      feedback.push(`「${word.word}」的重音评分较低，请听清示范中的重音后再读一次。`);
    } else {
      feedback.push(`「${word.word}」的发音评分较低，请先听示范，再单独朗读这个词。`);
    }
    if (feedback.length === 3) break;
  }
  return feedback;
}

function upstreamError(code: string | undefined): AppError {
  switch (code) {
    case 'error_no_speech':
    case 'error_word_alignment':
      return new AppError('PRONUNCIATION_NO_SPEECH', '录音中未检测到可评测的目标语音，请重新朗读字幕', 422);
    case 'error_audio_too_long':
    case 'error_file_too_large':
    case 'error_audio_missing':
    case 'error_convert_audio':
      return invalidAudio();
    case 'error_too_many_requests':
      return limitReached();
    case 'error_key_expired':
    case 'error_feature_unavailable':
      return notConfigured();
    case 'error_internal':
      return unavailable(true);
    default:
      return unavailable(false);
  }
}

function notConfigured(): AppError {
  return new AppError('PRONUNCIATION_NOT_CONFIGURED', '发音评分服务尚未正确配置', 503);
}

function invalidAudio(): AppError {
  return new AppError('PRONUNCIATION_AUDIO_INVALID', '录音无法用于发音评分，请重新录制清晰的英文朗读', 422);
}

function limitReached(): AppError {
  return new AppError('PRONUNCIATION_LIMIT_REACHED', '发音评分服务暂时达到调用上限，请稍后重试', 429, true);
}

function unavailable(retryable: boolean): AppError {
  return new AppError('PRONUNCIATION_UPSTREAM_UNAVAILABLE', '发音评分服务暂时不可用，请稍后重试', 503, retryable);
}

function invalidResult(): AppError {
  return new AppError('PRONUNCIATION_INVALID_RESULT', '发音评分结果无效，请重试', 502, true);
}
