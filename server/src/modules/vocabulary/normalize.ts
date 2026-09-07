import { createHash } from 'node:crypto';

import type { VocabularyInput } from '@context-reader/contracts';

import { AppError } from '../../core/errors';

const collapseWhitespace = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ');

export const normalizeTerm = (value: string): string =>
  collapseWhitespace(value).toLocaleLowerCase('en-US');

export const normalizeMeaningZh = (value: string): string =>
  collapseWhitespace(value);

export const vocabularyFingerprint = (term: string, meaningZh: string): string =>
  createHash('sha256')
    .update(`${normalizeTerm(term)}\u0000${normalizeMeaningZh(meaningZh)}`)
    .digest('hex');

export function rejectDuplicateInputs(items: readonly VocabularyInput[]): void {
  const fingerprints = new Set<string>();

  for (const item of items) {
    const fingerprint = vocabularyFingerprint(item.term, item.meaningZh);
    if (fingerprints.has(fingerprint)) {
      throw new AppError('VALIDATION_ERROR', '同一批词义不能重复', 400);
    }
    fingerprints.add(fingerprint);
  }
}
