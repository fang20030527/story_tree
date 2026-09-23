import { describe, expect, it } from 'vitest';

import {
  assertTranslationModerationAccepted,
  createTranslationSourceHash,
  validateTranslationText,
} from './validation';

describe('shared translation validation', () => {
  it.each([
    '{"sourceText":"为了改变该物种的命运，科学家们正努力保护雏鸟。 "}',
    '```json\n{"sourceText":"为了改变该物种的命运，科学家们正努力保护雏鸟。"}\n```',
    '{"translatedTextZh":"为了改变该物种的命运，科学家们正努力保护雏鸟。"}',
    '"为了改变该物种的命运，科学家们正努力保护雏鸟。"',
  ])('extracts translation text from a model wrapper: %s', (output) => {
    expect(validateTranslationText(output)).toBe('为了改变该物种的命运，科学家们正努力保护雏鸟。');
  });

  it.each([
    '{"sourceText":"译文"',
    '{"sourceText":"English only"}',
    '{"sourceText":null}',
    '{"sourceText":{"text":"译文"}}',
    '{"sourceText":" "}',
    '{"error":"翻译失败"}',
    '{"sourceText":"译文","other":"额外内容"}',
    '["译文"]',
    '```json\n{"sourceText":"译文"}',
    JSON.stringify({ sourceText: '{"sourceText":"译文"}' }),
  ])('rejects invalid or ambiguous structured output: %s', (output) => {
    expect(() => validateTranslationText(output)).toThrowError(
      expect.objectContaining({ code: 'AI_INVALID_OUTPUT', retryable: true }),
    );
  });

  it('preserves paragraphs and punctuation in plain translations', () => {
    expect(validateTranslationText('  “雏鸟”指的是幼鸟。\n\n第二段。  ')).toBe('“雏鸟”指的是幼鸟。\n\n第二段。');
  });

  it('accepts safe Han output and rejects invalid output', () => {
    expect(validateTranslationText('  译文：这是原创测试内容。 ')).toBe(
      '译文：这是原创测试内容。',
    );
    expect(() => validateTranslationText('English only')).toThrowError(
      expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }),
    );
  });

  it('rejects source text repeated inside an alleged Chinese translation', () => {
    expect(() => validateTranslationText('译文：Birds fly.', 'Birds fly.'))
      .toThrowError(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
    expect(validateTranslationText('鸟儿飞翔。', 'Birds fly.')).toBe('鸟儿飞翔。');
    expect(validateTranslationText('政治（Politics）', 'Politics')).toBe('政治（Politics）');
  });

  it('rejects English paragraphs labeled as translations', () => {
    const first = 'Letters are welcome via email to the editor and will be reviewed before publication.';
    const second = 'A varied, plant-heavy diet remains the most reliable way to improve your gut microbiome.';
    const source = `${first}\n\n${second}`;
    expect(() => validateTranslationText(`译文：${first}\n\n译文：${second}`, source))
      .toThrowError(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
    expect(() => validateTranslationText(`译文：${first}\n\n多样化的植物性饮食有助于改善肠道微生物群。`, source))
      .toThrowError(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
  });

  it('rejects predominantly English output even when the copied words are rearranged', () => {
    const source = 'Scientists are working to counter a lethal parenting method that dooms many chicks to death. Their field team studies wild birds in the rainforest.';
    const echoed = '译文：Scientists work to counter the lethal parenting method that dooms chicks to death. The field team studies wild birds in the rainforest.';
    expect(() => validateTranslationText(echoed, source))
      .toThrowError(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
    expect(validateTranslationText('科学家正在研究一种致命的育雏方式，野外团队也在雨林中观察野生鸟类。', source))
      .toContain('科学家');
  });

  it('allows unflagged medium-risk translations and blocks flagged or high-risk output', () => {
    expect(() =>
      assertTranslationModerationAccepted({
        riskLevel: 'medium',
        flagged: false,
      }),
    ).not.toThrow();

    expect(() =>
      assertTranslationModerationAccepted({ riskLevel: 'low', flagged: true }),
    ).toThrowError(expect.objectContaining({ code: 'AI_CONTENT_REJECTED' }));
    expect(() =>
      assertTranslationModerationAccepted({ riskLevel: 'high', flagged: false }),
    ).toThrowError(expect.objectContaining({ code: 'AI_CONTENT_REJECTED' }));
  });

  it('binds source hashes to resource, scope, paragraph, and exact text', () => {
    const base = createTranslationSourceHash(
      'article-a',
      'paragraph',
      'paragraph-a',
      'Original source text.',
    );
    expect(base).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      createTranslationSourceHash(
        'article-a',
        'full',
        null,
        'Original source text.',
      ),
    ).not.toBe(base);
    expect(
      createTranslationSourceHash(
        'article-b',
        'paragraph',
        'paragraph-a',
        'Original source text.',
      ),
    ).not.toBe(base);
  });
});
