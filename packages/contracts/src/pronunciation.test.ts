import { describe, expect, it } from 'vitest';
import { CreateSpeakingPronunciationRequestSchema, SpeakingPronunciationAssessmentDtoSchema, SpeakingPronunciationResultSchema } from './index';

const request = { assetId: '11111111-1111-4111-8111-111111111111', materialId: 'platform-one', cueId: 'cue-one', referenceText: 'Stay curious.', subtitleRevision: 1, locale: 'en-us' };
describe('发音评测契约', () => {
  it('要求云端字幕版本，本地素材使用独立字幕快照', () => {
    expect(CreateSpeakingPronunciationRequestSchema.parse(request)).toEqual(request);
    expect(CreateSpeakingPronunciationRequestSchema.safeParse({ ...request, subtitleRevision: null }).success).toBe(false);
    expect(CreateSpeakingPronunciationRequestSchema.safeParse({ ...request, materialId: null, subtitleRevision: null }).success).toBe(true);
    for (const change of [{ referenceText: '' }, { referenceText: '你好' }, { referenceText: 'a'.repeat(1001) }, { locale: 'zh-cn' }, { sourceUrl: 'https://example.test/audio' }]) {
      expect(CreateSpeakingPronunciationRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
    }
  });
  it('不能将缺失评分伪造为零分，也不能接受超出百分制的分数', () => {
    const result = { score: 80, words: [{ word: 'Stay', score: null, startMs: null, endMs: null, phonemes: [] }], feedback: [] };
    expect(SpeakingPronunciationResultSchema.parse(result).words[0]?.score).toBeNull();
    expect(SpeakingPronunciationResultSchema.safeParse({ ...result, score: 101 }).success).toBe(false);
    expect(SpeakingPronunciationResultSchema.safeParse({ ...result, words: [] }).success).toBe(false);
  });
  it('状态与结果、错误保持一致', () => {
    const dto = { ...request, id: request.assetId, provider: 'speechace', status: 'processing', result: null, error: null, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
    expect(SpeakingPronunciationAssessmentDtoSchema.safeParse(dto).success).toBe(true);
    expect(SpeakingPronunciationAssessmentDtoSchema.safeParse({ ...dto, status: 'ready' }).success).toBe(false);
    expect(SpeakingPronunciationAssessmentDtoSchema.safeParse({ ...dto, status: 'failed' }).success).toBe(false);
  });
});
