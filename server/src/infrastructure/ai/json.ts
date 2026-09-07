import { AppError } from '../../core/errors';

export function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const direct = parseJson(trimmed);
  if (direct.parsed) {
    if (isObject(direct.value)) return direct.value;
    throw invalidOutput();
  }

  for (const fenced of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) {
    const parsed = parseJson(fenced[1]?.trim() ?? '');
    if (parsed.parsed && isObject(parsed.value)) return parsed.value;
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== '{') continue;
    const candidate = readBalancedObject(trimmed, index);
    if (!candidate) continue;
    const parsed = parseJson(candidate);
    if (parsed.parsed && isObject(parsed.value)) return parsed.value;
  }

  throw invalidOutput();
}

function readBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function parseJson(text: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(text) as unknown };
  } catch {
    return { parsed: false };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidOutput(): AppError {
  return new AppError('AI_INVALID_OUTPUT', 'AI 返回格式无效', 502, true);
}
