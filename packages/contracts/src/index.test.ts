import { describe, expect, it } from 'vitest';

import {
  AnonymousAuthRequestSchema,
  AnonymousAuthResponseSchema,
  ArticleImportDtoSchema,
  AnswerResultSchema,
  AssistanceRequestSchema,
  AssistanceResponseSchema,
  CreateArticleImportRequestSchema,
  CreatePracticeAcceptedSchema,
  CreatePracticeRequestSchema,
  DashboardDtoSchema,
  EmailAuthRequestSchema,
  EmailAuthResponseSchema,
  ImportedArticlePageSchema,
  ImportedArticleDtoSchema,
  ImportedArticleSummaryDtoSchema,
  PublicErrorSchema,
  PublicQuestionSchema,
  SubmitAnswerRequestSchema,
  TranslationRequestSchema,
  UpdateImportPreviewRequestSchema,
  WechatAuthRequestSchema,
  WechatAuthResponseSchema,
} from './index';

describe('shared contracts', () => {
  it('requires an explicit 14+ confirmation for anonymous identity', () => {
    expect(
      AnonymousAuthRequestSchema.safeParse({ ageConfirmed14Plus: true }).success,
    ).toBe(true);
    expect(
      AnonymousAuthRequestSchema.safeParse({ ageConfirmed14Plus: false }).success,
    ).toBe(false);
    expect(
      AnonymousAuthRequestSchema.safeParse({
        ageConfirmed14Plus: true,
        birthDate: '2000-01-01',
      }).success,
    ).toBe(false);

    expect(
      AnonymousAuthResponseSchema.safeParse({
        userId: crypto.randomUUID(),
        kind: 'guest',
        remainingFreePractices: 3,
      }).success,
    ).toBe(true);
  });

  it('validates the WeChat authorization-code exchange contract', () => {
    expect(
      WechatAuthRequestSchema.safeParse({ code: 'wechat-code' }).success,
    ).toBe(true);
    expect(WechatAuthRequestSchema.safeParse({ code: '' }).success).toBe(false);
    expect(
      WechatAuthRequestSchema.safeParse({ code: 'wechat-code', state: 'state' })
        .success,
    ).toBe(false);

    expect(
      WechatAuthResponseSchema.safeParse({
        userId: crypto.randomUUID(),
        kind: 'registered',
        remainingFreePractices: 3,
      }).success,
    ).toBe(true);
    expect(
      WechatAuthResponseSchema.safeParse({
        userId: crypto.randomUUID(),
        kind: 'guest',
        remainingFreePractices: 3,
      }).success,
    ).toBe(false);
  });

  it('normalizes and validates email password authentication', () => {
    expect(
      EmailAuthRequestSchema.parse({
        email: '  Reader@Example.com ',
        password: 'correct-horse-battery-staple',
      }),
    ).toEqual({
      email: 'reader@example.com',
      password: 'correct-horse-battery-staple',
    });
    expect(
      EmailAuthRequestSchema.safeParse({
        email: 'not-an-email',
        password: 'short',
      }).success,
    ).toBe(false);
    expect(
      EmailAuthResponseSchema.safeParse({
        userId: crypto.randomUUID(),
        kind: 'registered',
        remainingFreePractices: 3,
      }).success,
    ).toBe(true);
  });

  it('accepts one to ten vocabulary inputs', () => {
    expect(
      CreatePracticeRequestSchema.safeParse({
        items: [{ term: 'resilient', meaningZh: '有韧性的' }],
      }).success,
    ).toBe(true);
    expect(CreatePracticeRequestSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      CreatePracticeRequestSchema.safeParse({
        items: Array.from({ length: 11 }, (_, index) => ({
          term: `term-${index}`,
          meaningZh: '义项',
        })),
      }).success,
    ).toBe(false);
  });

  it('validates the asynchronous practice creation response', () => {
    expect(
      CreatePracticeAcceptedSchema.safeParse({
        practiceId: crypto.randomUUID(),
        status: 'queued',
        remainingFreePractices: 2,
        pollAfterMs: 1_500,
      }).success,
    ).toBe(true);
    expect(
      CreatePracticeAcceptedSchema.safeParse({
        practiceId: crypto.randomUUID(),
        status: 'queued',
        remainingFreePractices: -1,
      }).success,
    ).toBe(false);
  });

  it('does not permit a correct answer in an unanswered question', () => {
    const result = PublicQuestionSchema.safeParse({
      id: crypto.randomUUID(),
      targetId: crypto.randomUUID(),
      term: 'resilient',
      prompt: '在本文语境中是什么意思？',
      options: Array.from({ length: 4 }, (_, index) => ({
        id: crypto.randomUUID(),
        label: `选项${index}`,
      })),
      submittedAnswer: null,
      correctOptionId: crypto.randomUUID(),
    });
    expect(result.success).toBe(false);
  });

  it('requires dont_know feedback to be incorrect with no selected option', () => {
    const feedback = {
      answerKind: 'dont_know',
      selectedOptionId: null,
      isCorrect: false,
      wasAssisted: false,
      correctOptionId: crypto.randomUUID(),
      meaningEn: 'able to recover quickly',
      explanationZh: '根据上下文可知。',
      optionExplanations: {},
    };

    expect(AnswerResultSchema.safeParse(feedback).success).toBe(true);
    expect(
      AnswerResultSchema.safeParse({
        ...feedback,
        selectedOptionId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(AnswerResultSchema.safeParse({ ...feedback, isCorrect: true }).success).toBe(false);
  });

  it('uses the stable public error envelope', () => {
    expect(
      PublicErrorSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: '输入有误',
          requestId: crypto.randomUUID(),
          retryable: false,
        },
      }).error.code,
    ).toBe('VALIDATION_ERROR');
  });

  it('accepts only paragraph or full translation scopes', () => {
    expect(
      TranslationRequestSchema.safeParse({
        scope: 'paragraph',
        paragraphId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
    expect(TranslationRequestSchema.safeParse({ scope: 'full' }).success).toBe(true);
    expect(
      TranslationRequestSchema.safeParse({
        scope: 'full',
        paragraphId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      TranslationRequestSchema.safeParse({ scope: 'paragraph' }).success,
    ).toBe(false);
  });

  it('validates assistance evidence and explicit answer kinds', () => {
    const targetId = crypto.randomUUID();
    const paragraphId = crypto.randomUUID();
    const questionId = crypto.randomUUID();
    const selectedOptionId = crypto.randomUUID();

    expect(
      AssistanceRequestSchema.safeParse({ kind: 'word_hint', targetId }).success,
    ).toBe(true);
    expect(
      AssistanceRequestSchema.safeParse({
        kind: 'paragraph_translation',
        paragraphId,
      }).success,
    ).toBe(true);
    expect(
      AssistanceRequestSchema.safeParse({ kind: 'full_translation' }).success,
    ).toBe(true);
    expect(
      AssistanceRequestSchema.safeParse({
        kind: 'full_translation',
        paragraphId,
      }).success,
    ).toBe(false);
    expect(
      AssistanceResponseSchema.safeParse({
        recorded: true,
        hintMeaningZh: '有韧性的',
      }).success,
    ).toBe(true);

    expect(
      SubmitAnswerRequestSchema.safeParse({
        answerKind: 'option',
        questionId,
        selectedOptionId,
        elapsedMs: 1_200,
      }).success,
    ).toBe(true);
    expect(
      SubmitAnswerRequestSchema.safeParse({
        answerKind: 'dont_know',
        questionId,
        elapsedMs: 1_200,
      }).success,
    ).toBe(true);
    expect(
      SubmitAnswerRequestSchema.safeParse({
        answerKind: 'dont_know',
        questionId,
        selectedOptionId,
        elapsedMs: 1_200,
      }).success,
    ).toBe(false);
  });

  it('validates the dashboard summary without accepting extra fields', () => {
    const summary = {
      incompletePracticeId: crypto.randomUUID(),
      vocabularyCount: 12,
      reviewingCount: 4,
      completedPracticeCount: 2,
      remainingFreePractices: 1,
    };

    expect(DashboardDtoSchema.safeParse(summary).success).toBe(true);
    expect(
      DashboardDtoSchema.safeParse({ ...summary, remainingFreePractices: -1 })
        .success,
    ).toBe(false);
    expect(
      DashboardDtoSchema.safeParse({
        ...summary,
        internalUserId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });

  it('accepts only strict, ordered article import source requests', () => {
    const asset = {
      position: 0,
      mediaType: 'image/jpeg',
      byteSize: 1_024,
    };

    expect(
      CreateArticleImportRequestSchema.parse({
        sourceKind: 'album',
        assets: [asset],
      }),
    ).toEqual({ sourceKind: 'album', assets: [asset] });
    expect(
      CreateArticleImportRequestSchema.safeParse({
        sourceKind: 'album',
        assets: [{ ...asset, position: 1 }],
      }).success,
    ).toBe(false);
    expect(
      CreateArticleImportRequestSchema.safeParse({
        sourceKind: 'local_file',
        assets: [asset, { ...asset, position: 1 }],
      }).success,
    ).toBe(false);
    expect(
      CreateArticleImportRequestSchema.safeParse({
        sourceKind: 'url',
        url: 'https://example.com/story',
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('enforces status-dependent article import fields', () => {
    const pending = ArticleImportDtoSchema.parse({
      id: crypto.randomUUID(),
      sourceKind: 'url',
      status: 'queued',
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      pollAfterMs: 1_500,
      failure: null,
      preview: null,
      articleId: null,
    });

    expect(pending.pollAfterMs).toBe(1_500);
    expect(
      ArticleImportDtoSchema.safeParse({
        ...pending,
        status: 'failed',
        pollAfterMs: 1_500,
        failure: {
          code: 'IMPORT_PARSE_FAILED',
          message: '解析失败',
          retryable: false,
        },
      }).success,
    ).toBe(false);
    expect(
      ArticleImportDtoSchema.safeParse({
        ...pending,
        status: 'preview_ready',
        pollAfterMs: undefined,
        preview: {
          title: 'A careful study',
          text: 'Evidence matters.',
          wordCount: 5_001,
          duplicate: { kind: 'none' },
        },
      }).success,
    ).toBe(false);
  });

  it('keeps preview edits and imported articles strict', () => {
    expect(
      UpdateImportPreviewRequestSchema.safeParse({
        title: 'A careful study',
        text: 'Original text',
        wordCount: 2,
      }).success,
    ).toBe(false);
    expect(
      ImportedArticleDtoSchema.safeParse({
        id: crypto.randomUUID(),
        sourceKind: 'paste',
        sourceUrl: null,
        title: 'A careful study',
        wordCount: 20,
        importedAt: new Date().toISOString(),
        paragraphs: [
          {
            id: crypto.randomUUID(),
            position: 0,
            text: 'Original synthetic paragraph.',
          },
        ],
        internalHash: 'secret',
      }).success,
    ).toBe(false);
  });

  it('validates strict private article summaries and bounded pages', () => {
    const item = {
      id: '11111111-1111-4111-8111-111111111111',
      sourceKind: 'url',
      sourceUrl: 'https://example.com/article',
      title: 'A private article',
      wordCount: 820,
      importedAt: '2026-09-12T08:00:00.000Z',
    };

    expect(ImportedArticleSummaryDtoSchema.parse(item)).toEqual(item);
    expect(ImportedArticleSummaryDtoSchema.safeParse({
      ...item,
      paragraphs: [],
    }).success).toBe(false);
    expect(ImportedArticlePageSchema.parse({
      items: [item],
      nextCursor: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTEyVDA4OjAwOjAwLjAwMFoiLCJpZCI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSJ9',
    }).items).toHaveLength(1);
    expect(ImportedArticlePageSchema.safeParse({
      items: Array.from({ length: 101 }, () => item),
      nextCursor: null,
    }).success).toBe(false);
  });
});
