import {
  WordTranslationDtoSchema,
  WordTranslationRequestSchema,
  type WordTranslationDto,
  type WordTranslationRequest,
} from '@context-reader/contracts';

import { dictionaryShards } from './generated';
import type { DictionaryEntry } from './types';

function normalizeTerm(term: string): string {
  return term.normalize('NFKC').replace(/[‘’]/gu, "'")
    .replace(/[‐‑–—]/gu, '-').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function findEntry(term: string): DictionaryEntry | undefined {
  const visited = new Set<string>();
  let key = term;
  while (!visited.has(key)) {
    visited.add(key);
    let shard = 0;
    for (const character of key) {
      shard = (shard * 31 + character.codePointAt(0)!) % dictionaryShards.length;
    }
    const entries = dictionaryShards[shard]();
    if (!Object.prototype.hasOwnProperty.call(entries, key)) return undefined;
    const entry = entries[key];
    if (typeof entry !== 'string') return entry;
    key = entry;
  }
  return undefined;
}

/** 只在精确词条与词典自带跳转都未命中时尝试常见词尾。 */
function wordForms(term: string): string[] {
  if (!/^[a-z]+(?:'s)?$/u.test(term)) return [];
  const candidates: string[] = [];
  if (term.endsWith("'s")) candidates.push(term.slice(0, -2));
  if (term.endsWith('ies')) candidates.push(term.slice(0, -3) + 'y');
  if (term.endsWith('s') && !term.endsWith('ss')) candidates.push(term.slice(0, -1));
  if (term.endsWith('es')) candidates.push(term.slice(0, -2));
  if (term.endsWith('ied')) candidates.push(term.slice(0, -3) + 'y');
  for (const suffix of ['ing', 'ed', 'er', 'est']) {
    if (!term.endsWith(suffix) || term.length < suffix.length + 3) continue;
    const stem = term.slice(0, -suffix.length);
    if (/([b-df-hj-np-tv-z])\1$/u.test(stem)) candidates.push(stem.slice(0, -1));
    candidates.push(stem, stem + 'e');
    if (stem.endsWith('i')) candidates.push(stem.slice(0, -1) + 'y');
  }
  return [...new Set(candidates)].filter((candidate) => candidate.length >= 2);
}

function includeBaseMeaning(entry: DictionaryEntry): string {
  if (!entry.baseTerm) return entry.meaningZh;
  const base = findEntry(entry.baseTerm);
  if (!base) return entry.meaningZh;
  const prefix = `${entry.meaningZh}\n${entry.baseTerm}：`;
  const available = 200 - prefix.length;
  if (available < 10) return entry.meaningZh;
  const meaning = base.meaningZh.length <= available
    ? base.meaningZh
    : `${base.meaningZh.slice(0, available - 1)}…`;
  return prefix + meaning;
}

/** 随应用发布的离线词典；context 仅为兼容现有接口，不做语境消歧。 */
export async function lookupLocalWord(request: WordTranslationRequest): Promise<WordTranslationDto> {
  const parsed = WordTranslationRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error('词语格式无效');
  const term = normalizeTerm(parsed.data.term);
  let entry = findEntry(term);
  if (!entry) {
    for (const candidate of wordForms(term)) {
      entry = findEntry(candidate);
      if (entry) break;
    }
  }
  if (!entry) throw new Error('本地词典未收录这个词');
  return WordTranslationDtoSchema.parse({
    term: parsed.data.term,
    partOfSpeech: entry.partOfSpeech,
    meaningZh: includeBaseMeaning(entry),
    phoneticUk: entry.phoneticUk ?? null,
    phoneticUs: entry.phoneticUs ?? null,
    savedSourceSentence: null,
  });
}
