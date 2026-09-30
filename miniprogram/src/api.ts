import {
  AnonymousAuthResponseSchema, EmailAuthResponseSchema, DashboardDtoSchema,
  PublishedEditorialCatalogSchema, PublishedEditorialArticleSchema, ImportedArticlePageSchema,
  ImportedArticleDtoSchema, VocabularyWordPageSchema, VocabularyItemDtoSchema,
  VocabularyWordMasterySchema, CreatePracticeRequestSchema, CreatePracticeAcceptedSchema,
  PracticeDtoSchema, SubmitAnswerRequestSchema, AnswerResultSchema, WordTranslationRequestSchema,
  WordTranslationDtoSchema, VocabularyInputSchema, ArticleImportDtoSchema,
  CreateArticleImportRequestSchema, PublicErrorSchema, TranslationDtoSchema,
  SentenceTranslationDtoSchema, SentenceTranslationRequestSchema,
  CreatedComputerUploadSessionSchema, ComputerUploadSessionDtoSchema,
  AssistanceRequestSchema, AssistanceResponseSchema, RetryFailedTopicsResponseSchema,
  type AssistanceRequest,
  type CreatePracticeRequest, type SubmitAnswerRequest, type VocabularyInput,
  ConfirmArticleImportRequestSchema, type ConfirmArticleImportRequest,
  type CreateArticleImportRequest, type VocabularyWordFilter,
} from '@context-reader/contracts';
import type { ZodType } from 'zod';

declare const __API_ORIGIN__: string;
export const apiOrigin = __API_ORIGIN__;
const TOKEN_KEY = 'bhe:installation:v1';
export class ApiError extends Error {
  constructor(message: string, readonly retryable = false, readonly code = '') { super(message); }
}
export function randomHex(length = 16): Promise<string> {
  return new Promise((resolve, reject) => wx.getRandomValues({ length,
    success: result => resolve(Array.from(new Uint8Array(result.randomValues), value => value.toString(16).padStart(2, '0')).join('')),
    fail: () => reject(new ApiError('设备无法生成安全凭据，请更新微信后重试')),
  }));
}
let credential: Promise<string> | null = null;
let sessionGeneration = 0;
function assertSession(generation: number) {
  if (generation !== sessionGeneration) throw new ApiError('登录状态已变化，请重新操作');
}
export function installationToken(): Promise<string> {
  const generation = sessionGeneration;
  if (!credential) credential = (async () => {
    const stored: unknown = wx.getStorageSync(TOKEN_KEY);
    if (typeof stored === 'string' && /^[0-9a-f]{64}$/u.test(stored)) return stored;
    const token = await randomHex(32); assertSession(generation); wx.setStorageSync(TOKEN_KEY, token); return token;
  })().finally(() => { if (generation === sessionGeneration) credential = null; });
  return credential;
}
export function logout() {
  sessionGeneration += 1; credential = null;
  wx.removeStorageSync(TOKEN_KEY); wx.removeStorageSync('bhe:user'); wx.removeStorageSync('bhe:age');
  for (const key of wx.getStorageInfoSync().keys) if (key.startsWith('bhe:operation:')) wx.removeStorageSync(key);
}
type Options = { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; public?: boolean; key?: string; contentType?: string; timeout?: number };
export async function request<T>(path: string, schema: ZodType<T>, options: Options = {}): Promise<T> {
  const generation = sessionGeneration;
  const header: Record<string, string> = { 'Content-Type': options.contentType ?? 'application/json' };
  if (!options.public) { header.Authorization = `Bearer ${await installationToken()}`; assertSession(generation); }
  if (options.key) header['Idempotency-Key'] = options.key;
  return new Promise((resolve, reject) => {
    wx.request({ url: apiOrigin + path, method: options.method ?? 'GET', data: options.body as WechatMiniprogram.IAnyObject,
      header, timeout: options.timeout ?? 30_000,
      success: result => {
        if (!options.public && generation !== sessionGeneration) { reject(new ApiError('登录状态已变化，请重新操作')); return; }
        if (result.statusCode < 200 || result.statusCode >= 300) {
          const parsed = PublicErrorSchema.safeParse(result.data);
          reject(parsed.success ? new ApiError(parsed.data.error.message, parsed.data.error.retryable, parsed.data.error.code) : new ApiError('服务暂时无法响应，请稍后重试', true)); return;
        }
        const parsed = schema.safeParse(result.data);
        if (!parsed.success) { reject(new ApiError('服务返回的数据格式有误，请稍后重试', true)); return; }
        resolve(parsed.data);
      }, fail: () => reject(new ApiError('网络连接失败，请检查连接后重试', true)),
    });
  });
}

async function mutate<T>(path: string, schema: ZodType<T>, body: unknown, operation?: string, method: 'POST' | 'PUT' = 'POST', contentType?: string): Promise<T> {
  const generation = sessionGeneration;
  const token = await installationToken();
  assertSession(generation);
  const storageKey = `bhe:operation:${token}:${operation ?? path}`;
  const previous = wx.getStorageSync(storageKey) as { body: string; key: string } | undefined;
  const encoded = JSON.stringify(body);
  if (previous && previous.body !== encoded) throw new ApiError('上一条请求尚未确认，请先使用原内容重试');
  const key = previous?.key ?? await randomHex();
  assertSession(generation);
  wx.setStorageSync(storageKey, { body: encoded, key });
  try { const result = await request(path, schema, { method, body, key, ...(contentType ? { contentType } : {}), timeout: 120_000 }); wx.removeStorageSync(storageKey); return result; }
  catch (error) { if (error instanceof ApiError && !error.retryable) wx.removeStorageSync(storageKey); throw error; }
}
const post = <T>(path: string, schema: ZodType<T>, body: unknown, operation?: string) => mutate(path, schema, body, operation);
export async function ensureSession(): Promise<void> {
  const generation = sessionGeneration;
  if (wx.getStorageSync('bhe:age') !== true) {
    const accepted = await new Promise<boolean>(resolve => wx.showModal({ title: '开始云端学习', content: '请确认你已满 14 周岁，再使用云端词库、练习和导入功能。', confirmText: '已满 14 岁', cancelText: '暂不使用', success: result => resolve(result.confirm), fail: () => resolve(false) }));
    if (!accepted) throw new ApiError('已取消，可以继续浏览外刊');
    assertSession(generation);
    const user = await request('/v1/auth/anonymous', AnonymousAuthResponseSchema, { method: 'POST', body: { ageConfirmed14Plus: true } });
    assertSession(generation);
    wx.setStorageSync('bhe:user', user);
    wx.setStorageSync('bhe:age', true);
  }
}

export const services = {
  catalog: () => request('/v1/editorial/articles', PublishedEditorialCatalogSchema, { public: true }),
  article: (id: string) => request(`/v1/editorial/articles/${encodeURIComponent(id)}`, PublishedEditorialArticleSchema, { public: true }),
  dashboard: () => request('/v1/dashboard?timeZone=Asia%2FShanghai', DashboardDtoSchema),
  words: (filter: VocabularyWordFilter = 'all', cursor = '') => request(`/v1/vocabulary-words?filter=${filter}&limit=100&timeZone=Asia%2FShanghai${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, VocabularyWordPageSchema),
  imported: (cursor = '') => request(`/v1/articles?limit=30&includeCover=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, ImportedArticlePageSchema),
  importedArticle: (id: string) => request(`/v1/articles/${encodeURIComponent(id)}`, ImportedArticleDtoSchema),
  async login(email: string, password: string) {
    const generation = sessionGeneration;
    await ensureSession();
    assertSession(generation);
    const user = await request('/v1/auth/email', EmailAuthResponseSchema, { method: 'POST', body: { email, password } });
    assertSession(generation);
    wx.setStorageSync('bhe:user', { ...user, email }); return user;
  },
  createPractice: (input: CreatePracticeRequest) => post('/v1/practices', CreatePracticeAcceptedSchema, CreatePracticeRequestSchema.parse(input), 'practice'),
  practice: (id: string) => request(`/v1/practices/${encodeURIComponent(id)}?includeProgress=1`, PracticeDtoSchema),
  answer: (id: string, input: SubmitAnswerRequest) => post(`/v1/practices/${encodeURIComponent(id)}/answers`, AnswerResultSchema, SubmitAnswerRequestSchema.parse(input), `answer:${id}:${input.questionId}`),
  assistance: (id: string, input: AssistanceRequest) => post(`/v1/practices/${encodeURIComponent(id)}/assistance`, AssistanceResponseSchema, AssistanceRequestSchema.parse(input), `assistance:${id}:${JSON.stringify(input)}`),
  retryTopics: (id: string) => post(`/v1/practices/${encodeURIComponent(id)}/retry-failed`, RetryFailedTopicsResponseSchema, {}, `retry:${id}`),
  lookup: (term: string, context: string) => post('/v1/word-translations', WordTranslationDtoSchema, WordTranslationRequestSchema.parse({ term, context: context.slice(0, 1000) }), `lookup:${term}`),
  addWord: (input: VocabularyInput) => post('/v1/vocabulary-items', VocabularyItemDtoSchema, VocabularyInputSchema.parse(input), `word:${input.term}`),
  mastered: (id: string) => post(`/v1/vocabulary-words/${encodeURIComponent(id)}/mastered`, VocabularyWordMasterySchema, {}, `mastered:${id}`),
  createImport: (input: CreateArticleImportRequest) => post('/v1/imports', ArticleImportDtoSchema, CreateArticleImportRequestSchema.parse(input), 'import'),
  getImport: (id: string) => request(`/v1/imports/${encodeURIComponent(id)}`, ArticleImportDtoSchema),
  paste: (id: string, text: string) => mutate(`/v1/imports/${encodeURIComponent(id)}/source-text`, ArticleImportDtoSchema, text, `paste:${id}`, 'PUT', 'text/plain; charset=utf-8'),
  asset: (id: string, position: number, bytes: ArrayBuffer, mediaType: string) => request(`/v1/imports/${encodeURIComponent(id)}/assets/${position}`, ArticleImportDtoSchema, { method: 'PUT', body: bytes, contentType: mediaType }),
  processImport: (id: string) => post(`/v1/imports/${encodeURIComponent(id)}/process`, ArticleImportDtoSchema, {}, `process:${id}`),
  retryImport: (id: string) => post(`/v1/imports/${encodeURIComponent(id)}/retry`, ArticleImportDtoSchema, {}, `retry:${id}`),
  confirmImport: (id: string, decision: ConfirmArticleImportRequest = {}) => post(`/v1/imports/${encodeURIComponent(id)}/confirm`, ArticleImportDtoSchema, ConfirmArticleImportRequestSchema.parse(decision), `confirm:${id}`),
  translation: (id: string, source: string) => post(`/v1/${source === 'practice' ? 'practices' : source === 'imported' ? 'articles' : 'editorial/articles'}/${encodeURIComponent(id)}/translations`, TranslationDtoSchema, { scope: 'full' }, `translation:${source}:${id}`),
  getTranslation: (id: string, source: string) => request(`/v1/${source === 'practice' ? 'translations' : 'article-translations'}/${encodeURIComponent(id)}`, TranslationDtoSchema),
  sentence: (text: string) => post('/v1/sentence-translations', SentenceTranslationDtoSchema, SentenceTranslationRequestSchema.parse({ text }), `sentence:${text.slice(0, 40)}`),
  computer: () => post('/v1/computer-upload-sessions', CreatedComputerUploadSessionSchema, {}, 'computer'),
  computerStatus: (id: string) => request(`/v1/computer-upload-sessions/${encodeURIComponent(id)}`, ComputerUploadSessionDtoSchema),
};
export type Services = typeof services;
