import {
  CreatePracticeWithItemsRequestSchema,
  type CreatePracticeWithItemsRequest,
} from '@context-reader/contracts';

import { lookupLocalWordSync } from '@/features/dictionary/lookup';

/**
 * 草稿行仍按接口字段保存。用户只录入 term；meaningZh 由本地词典补全，
 * 从生词本带来的行保留原释义，空串表示还没查过。
 */
export interface VocabularyDraftRow {
  term: string;
  meaningZh: string;
  sourceSentence: string;
}

export type VocabularyDraftRowErrors = { term?: string };

export type VocabularyDraftValidation =
  | {
      success: true;
      request: CreatePracticeWithItemsRequest;
      rowErrors: VocabularyDraftRowErrors[];
      formError: null;
    }
  | {
      success: false;
      request: null;
      rowErrors: VocabularyDraftRowErrors[];
      formError: string | null;
    };

/** 接口要求 meaningZh 非空：词典查不到时用这句占位，生成时按常见含义处理。 */
export const UNLISTED_MEANING_ZH = '词典未收录，按常见含义练习';

export const MAX_DRAFT_WORDS = 10;

export function isUnlistedMeaning(meaningZh: string): boolean {
  return meaningZh.trim() === UNLISTED_MEANING_ZH;
}

export function emptyDraftRow(): VocabularyDraftRow {
  return { term: '', meaningZh: '', sourceSentence: '' };
}

/** 改单词时旧释义和原句都不再对应，一并清空，等待重新查词。 */
export function withTerm(row: VocabularyDraftRow, term: string): VocabularyDraftRow {
  return row.term === term ? row : { term, meaningZh: '', sourceSentence: '' };
}

export function lookupDictionaryMeaning(term: string): string | null {
  try {
    return lookupLocalWordSync({ term }).meaningZh;
  } catch {
    return null;
  }
}

/**
 * 给还没有释义的行查本地词典。markMissing 为 false 时只填查到的，
 * 适合输入停顿时调用，避免半个单词就被标成未收录。
 */
export function resolveDraftMeanings(
  rows: VocabularyDraftRow[],
  markMissing: boolean,
  lookup: (term: string) => string | null = lookupDictionaryMeaning,
): VocabularyDraftRow[] {
  let changed = false;
  const next = rows.map((row) => {
    const term = row.term.trim();
    if (!term || row.meaningZh.trim()) return row;
    const meaningZh = lookup(term) ?? (markMissing ? UNLISTED_MEANING_ZH : null);
    if (!meaningZh) return row;
    changed = true;
    return { ...row, meaningZh };
  });
  return changed ? next : rows;
}

function normalizeWhitespace(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function fieldMessage(field: unknown): string {
  switch (field) {
    case 'term':
      return '单词或短语不能超过 80 个字符';
    case 'sourceSentence':
      return '原句过长，请删除这个单词后重新录入';
    default:
      return '没有可用的释义，请删除后重新录入';
  }
}

/** 空行直接忽略；查词尚未完成的行不报错，但也不允许提交。 */
export function validateVocabularyDraft(
  rows: VocabularyDraftRow[],
): VocabularyDraftValidation {
  const rowErrors: VocabularyDraftRowErrors[] = rows.map(() => ({}));
  const filled = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.term.trim());

  if (!filled.length) {
    return { success: false, request: null, rowErrors, formError: '请至少录入 1 个单词' };
  }
  if (filled.length > MAX_DRAFT_WORDS) {
    return { success: false, request: null, rowErrors, formError: `最多录入 ${MAX_DRAFT_WORDS} 个单词` };
  }

  let ready = true;
  const seen = new Set<string>();
  for (const { row, index } of filled) {
    if (!row.meaningZh.trim()) {
      ready = false;
      continue;
    }
    const fingerprint = `${normalizeWhitespace(row.term).toLocaleLowerCase('en-US')}\u0000${normalizeWhitespace(row.meaningZh)}`;
    if (seen.has(fingerprint)) rowErrors[index] = { term: '这个单词已经录入过了' };
    seen.add(fingerprint);
  }

  const parsed = CreatePracticeWithItemsRequestSchema.safeParse({
    items: filled.map(({ row }) => ({
      term: row.term,
      meaningZh: row.meaningZh,
      ...(row.sourceSentence.trim() ? { sourceSentence: row.sourceSentence } : {}),
    })),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [, position, field] = issue.path;
      const target = typeof position === 'number' ? filled[position] : undefined;
      // 释义为空说明还在查词，由提交前的补全处理，不提示错误。
      if (!target || (field === 'meaningZh' && !target.row.meaningZh.trim())) continue;
      rowErrors[target.index] = { term: rowErrors[target.index].term ?? fieldMessage(field) };
    }
  }

  const hasRowError = rowErrors.some((error) => error.term);
  if (parsed.success && ready && !hasRowError) {
    return { success: true, request: parsed.data, rowErrors, formError: null };
  }
  return { success: false, request: null, rowErrors, formError: null };
}
