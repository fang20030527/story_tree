import { describe, expect, it } from 'vitest';

import { extractJsonObject } from './json';

describe('AI JSON extraction', () => {
  it('extracts an object from a markdown fence or surrounding prose', () => {
    expect(extractJsonObject('```json\n{"title":"A"}\n```')).toEqual({ title: 'A' });
    expect(
      extractJsonObject('Result: {"title":"A","nested":{"brace":"}"}} done.'),
    ).toEqual({ title: 'A', nested: { brace: '}' } });
  });

  it('rejects output without a valid JSON object', () => {
    expect(() => extractJsonObject('not json')).toThrowError(
      expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }),
    );
    expect(() => extractJsonObject('["not", "an", "object"]')).toThrowError(
      expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }),
    );
  });
});
