import { describe, expect, it } from 'vitest';

import {
  CreateSpeakingAssetRequestSchema,
  CompleteSpeakingAssetRequestSchema,
  CreateSpeakingMaterialRequestSchema,
  ImportSpeakingSubtitlesRequestSchema,
  SaveSpeakingSessionRequestSchema,
  SPEAKING_MAX_MEDIA_BYTES,
  SpeakingLibraryQuerySchema,
  SpeakingMaterialSummarySchema,
  SpeakingCatalogDtoSchema,
  SpeakingAssetDtoSchema,
  SpeakingLibraryDtoSchema,
  SpeakingMaterialListSchema,
  SpeakingCueSchema,
  SpeakingCuesSchema,
  UpdateSpeakingStateRequestSchema,
} from './index';

const cue = { id: 'line-1', start: 1, end: 3, en: 'Keep moving forward.', zh: '' };
const material = {
  sourceKind: 'youtube' as const,
  videoId: 'M7lc1UVf-VE',
  title: 'Synthetic practice',
  duration: 60,
  cues: [cue],
};

describe('口语素材 API 契约', () => {
  it('允许影视对白重叠，要求字幕开始时间有序且编号唯一', () => {
    expect(SpeakingCuesSchema.parse([
      cue,
      { ...cue, id: 'line-2', start: 2, end: 4 },
    ])).toHaveLength(2);
    expect(SpeakingCuesSchema.safeParse([
      cue,
      { ...cue, id: 'line-2', start: 0, end: 2 },
    ]).success).toBe(false);
    expect(SpeakingCuesSchema.safeParse([cue, cue]).success).toBe(false);
  });

  it.each([
    { ...cue, start: -1 },
    { ...cue, start: 3 },
    { ...cue, end: Number.NaN },
    { ...cue, end: Number.POSITIVE_INFINITY },
    { ...cue, en: '   ' },
    { ...cue, id: '../line' },
    { ...cue, unknown: true },
  ])('拒绝非法字幕或额外字段', (value) => {
    expect(SpeakingCueSchema.safeParse(value).success).toBe(false);
  });

  it('媒体声明上限为 3 GiB，默认用于素材并拒绝未知字段', () => {
    expect(CreateSpeakingAssetRequestSchema.parse({
      contentType: 'video/mp4', byteSize: SPEAKING_MAX_MEDIA_BYTES,
    }).purpose).toBe('material');
    for (const byteSize of [0, -1, 1.5, SPEAKING_MAX_MEDIA_BYTES + 1]) {
      expect(CreateSpeakingAssetRequestSchema.safeParse({
        contentType: 'video/mp4', byteSize,
      }).success).toBe(false);
    }
    expect(CreateSpeakingAssetRequestSchema.safeParse({
      contentType: 'video/mp4', byteSize: 1, filename: 'private.mp4',
    }).success).toBe(false);
  });

  it('旧代理资产响应仍有效，直传只增加严格的短期地址', () => {
    const id = crypto.randomUUID();
    const asset = { id, status: 'awaiting_upload', uploadPath: `/v1/speaking/assets/${id}/content`,
      byteSize: 1, contentType: 'video/mp4', duration: 0, expiresAt: '2026-10-01T08:00:00.000Z' };
    expect(SpeakingAssetDtoSchema.parse(asset)).toEqual(asset);
    const directUpload = { url: 'https://r2.example.test/private-file?signature=temporary', expiresAt: asset.expiresAt };
    expect(SpeakingAssetDtoSchema.parse({ ...asset, directUpload })).toEqual({ ...asset, directUpload });
    for (const value of [{ ...directUpload, url: '../file' }, { ...directUpload, expiresAt: 'tomorrow' }, { ...directUpload, token: 'private' }]) {
      expect(SpeakingAssetDtoSchema.safeParse({ ...asset, directUpload: value }).success).toBe(false);
    }
  });

  it('确认只接受实际有限时长，最大 24 小时且拒绝额外字段', () => {
    expect(CompleteSpeakingAssetRequestSchema.parse({ duration: 86_400 })).toEqual({ duration: 86_400 });
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 86_400.001]) {
      expect(CompleteSpeakingAssetRequestSchema.safeParse({ duration }).success).toBe(false);
    }
    expect(CompleteSpeakingAssetRequestSchema.safeParse({ duration: 60, storageKey: 'private-file' }).success).toBe(false);
  });

  it('YouTube 只接收视频编号与已有字幕，不接收任意 URL', () => {
    expect(CreateSpeakingMaterialRequestSchema.parse(material).sourceKind).toBe('youtube');
    for (const videoId of ['https://youtu.be/M7lc1UVf-VE', 'short', '../private']) {
      expect(CreateSpeakingMaterialRequestSchema.safeParse({ ...material, videoId }).success).toBe(false);
    }
    expect(CreateSpeakingMaterialRequestSchema.safeParse({ ...material, cues: [] }).success).toBe(false);
    expect(CreateSpeakingMaterialRequestSchema.safeParse({ ...material, url: 'https://example.invalid' }).success).toBe(false);
  });

  it('字幕更新必须包含版本号和支持的格式', () => {
    const request = { revision: 1, format: 'srt', text: '1\n00:00:01,000 --> 00:00:02,000\nHello.\n' };
    expect(ImportSpeakingSubtitlesRequestSchema.safeParse(request).success).toBe(true);
    expect(ImportSpeakingSubtitlesRequestSchema.safeParse({ ...request, revision: 0 }).success).toBe(false);
    expect(ImportSpeakingSubtitlesRequestSchema.safeParse({ ...request, format: 'ass' }).success).toBe(false);
  });

  it('状态更新允许初始版本零，但不接受空修改或私有资源字段', () => {
    expect(UpdateSpeakingStateRequestSchema.parse({ revision: 0, position: 0 })).toEqual({ revision: 0, position: 0 });
    expect(UpdateSpeakingStateRequestSchema.safeParse({ revision: 0 }).success).toBe(false);
    expect(UpdateSpeakingStateRequestSchema.safeParse({ revision: 0, userId: crypto.randomUUID(), position: 0 }).success).toBe(false);
    expect(UpdateSpeakingStateRequestSchema.safeParse({ revision: 0, notes: { '../line': 'Invalid' } }).success).toBe(false);
  });

  it('练习累计时长与字幕数量受到范围限制', () => {
    const session = {
      materialId: 'curiosity', date: '2026-10-01T08:00:00.000Z',
      elapsedMs: 1_500, cueCount: 1, position: 3,
    };
    expect(SaveSpeakingSessionRequestSchema.safeParse(session).success).toBe(true);
    expect(SaveSpeakingSessionRequestSchema.safeParse({ ...session, elapsedMs: -1 }).success).toBe(false);
    expect(SaveSpeakingSessionRequestSchema.safeParse({ ...session, elapsedMs: 86_400_001 }).success).toBe(false);
    expect(SaveSpeakingSessionRequestSchema.safeParse({ ...session, cueCount: 10_001 }).success).toBe(false);
    expect(SaveSpeakingSessionRequestSchema.safeParse({ ...session, position: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('素材库只传字幕数量，不把整片字幕放入摘要', () => {
    const summary = {
      id: 'curiosity', title: 'Synthetic material', subtitle: '', category: '练习',
      sourceKind: 'platform', mediaType: 'audio', assetId: null, videoId: null,
      duration: 60, revision: 1, createdAt: '2026-10-01T08:00:00.000Z', cueCount: 2,
    };
    expect(SpeakingMaterialSummarySchema.parse(summary)).toEqual(summary);
    expect(SpeakingMaterialSummarySchema.safeParse({ ...summary, cues: [cue] }).success).toBe(false);
  });

  it('分页默认 20 条并拒绝非法游标与超限页大小', () => {
    expect(SpeakingLibraryQuerySchema.parse({})).toEqual({ limit: 20 });
    for (const query of [{ limit: 0 }, { limit: 51 }, { cursor: '../private' }, { sourceUrl: 'https://example.invalid' }]) {
      expect(SpeakingLibraryQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('公共目录只接收平台摘要，不暴露内部媒体清单或字幕', () => {
    const summary = platformSummary();
    expect(SpeakingCatalogDtoSchema.parse({ materials: [summary] })).toEqual({ materials: [summary] });
    for (const changed of [
      { ...summary, cues: [cue] }, { ...summary, storageKey: 'speaking/platform/private.mp4' },
      { ...summary, sourceKind: 'file', assetId: crypto.randomUUID() },
    ]) expect(SpeakingCatalogDtoSchema.safeParse({ materials: [changed] }).success).toBe(false);
    expect(SpeakingCatalogDtoSchema.safeParse({ materials: Array.from({ length: 101 }, (_, index) => platformSummary(`platform-${index}`)) }).success).toBe(false);
  });

  it('素材库允许一百份平台摘要与五十份个人素材，仍限制单次规模', () => {
    const materials = [
      ...Array.from({ length: 100 }, (_, index) => platformSummary(`platform-${index}`)),
      ...Array.from({ length: 50 }, () => ({ ...platformSummary(crypto.randomUUID()), sourceKind: 'file', assetId: crypto.randomUUID() })),
    ];
    const states = materials.map(value => ({ materialId: value.id, revision: 0, savedCueIds: [], notes: {}, position: 0, recording: null }));
    expect(SpeakingMaterialListSchema.safeParse({ materials, nextCursor: null }).success).toBe(true);
    expect(SpeakingLibraryDtoSchema.safeParse({ materials, states, sessions: [], nextCursor: null }).success).toBe(true);
    expect(SpeakingLibraryDtoSchema.safeParse({ materials: [...materials, platformSummary('too-many')], states, sessions: [], nextCursor: null }).success).toBe(false);
    expect(SpeakingLibraryDtoSchema.safeParse({ materials, states: [...states, states[0]], sessions: [], nextCursor: null }).success).toBe(false);
  });
});

function platformSummary(id = 'public-example') {
  return { id, title: 'Public example', subtitle: '', category: '电影对白', sourceKind: 'platform', mediaType: 'video',
    assetId: null, videoId: null, duration: 60, revision: 1, createdAt: '2026-10-01T08:00:00.000Z', cueCount: 1 };
}
