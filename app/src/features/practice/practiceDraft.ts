import {
  CreatePracticeWithItemsRequestSchema,
  type CreatePracticeWithItemsRequest,
} from '@context-reader/contracts';

export interface VocabularyDraftRow {
  term: string;
  meaningZh: string;
  sourceSentence: string;
}

export type VocabularyDraftField = keyof VocabularyDraftRow;
export type VocabularyDraftRowErrors = Partial<
  Record<VocabularyDraftField, string>
>;

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

function toRequestCandidate(rows: VocabularyDraftRow[]) {
  return {
    items: rows.map((row) => ({
      term: row.term,
      meaningZh: row.meaningZh,
      ...(row.sourceSentence.trim()
        ? { sourceSentence: row.sourceSentence }
        : {}),
    })),
  };
}

function fieldMessage(field: VocabularyDraftField): string {
  switch (field) {
    case 'term':
      return '请输入不超过 80 个字符的单词或短语';
    case 'meaningZh':
      return '请输入不超过 200 个字符的具体中文义项';
    case 'sourceSentence':
      return '原句不能超过 1000 个字符';
  }
}

function normalizeWhitespace(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function markDuplicateRows(
  rows: VocabularyDraftRow[],
  rowErrors: VocabularyDraftRowErrors[],
): boolean {
  const fingerprints = new Map<string, number>();
  let hasDuplicate = false;

  rows.forEach((row, rowIndex) => {
    const term = normalizeWhitespace(row.term).toLocaleLowerCase('en-US');
    const meaningZh = normalizeWhitespace(row.meaningZh);
    if (!term || !meaningZh) return;

    const fingerprint = `${term}\u0000${meaningZh}`;
    if (fingerprints.has(fingerprint)) {
      rowErrors[rowIndex] = {
        ...rowErrors[rowIndex],
        meaningZh: '该单词和义项已重复',
      };
      hasDuplicate = true;
      return;
    }
    fingerprints.set(fingerprint, rowIndex);
  });

  return hasDuplicate;
}

export function validateVocabularyDraft(
  rows: VocabularyDraftRow[],
): VocabularyDraftValidation {
  const rowErrors: VocabularyDraftRowErrors[] = rows.map(() => ({}));
  const parsed = CreatePracticeWithItemsRequestSchema.safeParse(
    toRequestCandidate(rows),
  );
  const hasDuplicate = markDuplicateRows(rows, rowErrors);

  if (parsed.success && !hasDuplicate) {
    return {
      success: true,
      request: parsed.data,
      rowErrors,
      formError: null,
    };
  }

  let formError: string | null = null;
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [, rowIndex, field] = issue.path;
      if (
        typeof rowIndex === 'number'
        && (field === 'term'
          || field === 'meaningZh'
          || field === 'sourceSentence')
      ) {
        rowErrors[rowIndex] = {
          ...rowErrors[rowIndex],
          [field]: fieldMessage(field),
        };
      } else {
        formError = '请录入 1–10 个具体义项';
      }
    }
  }

  return {
    success: false,
    request: null,
    rowErrors,
    formError,
  };
}
