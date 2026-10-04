// Tolerant reader for model output. It repairs the shape of a reply (wrappers, arrays versus
// objects, synonym keys, extra keys) and fills neutral defaults for whatever is missing, so
// formatting slips never cost a whole rewrite. Content is never invented here: a missing
// answer index stays -1 and a missing prompt stays empty for the validator to repair.

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return typeof value === 'number' ? String(value) : undefined;
}

function pick(source: Json, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

/** Array items, or the entries of an object keyed by paragraph key, alias or option letter. */
function entries(value: unknown): Array<[string | undefined, unknown]> {
  if (Array.isArray(value)) return value.map((item): [string | undefined, unknown] => [undefined, item]);
  if (isRecord(value)) {
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }));
  }
  return [];
}

function strings(value: unknown): string[] {
  return entries(value).flatMap(([, item]) => text(item) ?? []);
}

const WRAPPER_KEYS = ['practice', 'artifact', 'result', 'data', 'output', 'response', 'article'];

function unwrap(raw: Json): Json {
  if (raw.paragraphs !== undefined) return raw;
  const candidates = [...WRAPPER_KEYS.map((key) => raw[key]), ...Object.values(raw)];
  return candidates.find((candidate): candidate is Json => isRecord(candidate) && candidate.paragraphs !== undefined) ?? raw;
}

/** The answer position as a number; -1 when the reply gives none the validator can read. */
function optionIndex(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/u.test(trimmed)) return Number(trimmed);
    if (/^[A-Da-d]$/u.test(trimmed)) return trimmed.toUpperCase().charCodeAt(0) - 65;
  }
  return -1;
}

/**
 * Normalise a generated practice before schema parsing. Unknown keys are dropped; synonym
 * keys are renamed; objects keyed by paragraph key or alias become arrays; missing pieces
 * get neutral defaults. A reply without any paragraph stays invalid for the schema.
 */
export function coerceGeneratedPractice(raw: Json): Json {
  const source = unwrap(raw);
  return {
    title: text(pick(source, 'title', 'Title', 'headline')) ?? '',
    paragraphs: entries(source.paragraphs).flatMap(([entryKey, item], index) => {
      if (typeof item === 'string') return [{ key: entryKey ?? `p${index + 1}`, text: item }];
      if (!isRecord(item)) return [];
      return [{
        key: text(pick(item, 'key', 'id', 'name')) ?? entryKey ?? `p${index + 1}`,
        text: text(pick(item, 'text', 'content', 'paragraph', 'body')) ?? '',
      }];
    }),
    usages: entries(source.usages).flatMap(([entryKey, item]) => {
      if (!isRecord(item)) return [];
      return [{
        targetAlias: text(pick(item, 'targetAlias', 'alias', 'target')) ?? entryKey ?? '',
        paragraphKey: text(pick(item, 'paragraphKey', 'paragraph')) ?? '',
        surfaceForm: text(pick(item, 'surfaceForm', 'surface', 'form', 'text')) ?? '',
      }];
    }),
    // A target may have several questions, so a reply keyed by alias can hold a list per alias.
    questions: entries(source.questions).flatMap(([entryKey, group]) =>
      (Array.isArray(group) ? group : [group]).flatMap((item) => {
        if (!isRecord(item)) return [];
        return [{
          targetAlias: text(pick(item, 'targetAlias', 'alias')) ?? entryKey ?? '',
          prompt: text(pick(item, 'prompt', 'question')) ?? '',
          optionsEn: strings(pick(item, 'optionsEn', 'options')),
          correctOptionIndex: optionIndex(pick(item, 'correctOptionIndex', 'correctIndex')),
          meaningEn: text(item.meaningEn) ?? '',
          explanationZh: text(item.explanationZh) ?? '',
          optionExplanationsZh: strings(item.optionExplanationsZh),
          optionExplanationsEn: strings(item.optionExplanationsEn),
        }];
      })),
  };
}
