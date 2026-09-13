import type { ArticleImportDto } from '@context-reader/contracts';

import { confirmArticleImport } from '@/api/imports';
import {
  clearActiveImportIdIfMatches,
  clearImportOperationKeys,
  loadOrCreateImportOperationKey,
} from './importStorage';
import { autoConfirmArticleImport } from './autoConfirm';

jest.mock('@/api/imports', () => ({
  confirmArticleImport: jest.fn(),
}));
jest.mock('./importStorage', () => ({
  clearActiveImportIdIfMatches: jest.fn().mockResolvedValue(undefined),
  clearImportOperationKeys: jest.fn().mockResolvedValue(undefined),
  loadOrCreateImportOperationKey: jest.fn().mockResolvedValue('confirm-key'),
}));

const confirm = confirmArticleImport as jest.MockedFunction<typeof confirmArticleImport>;
const loadKey = loadOrCreateImportOperationKey as jest.MockedFunction<typeof loadOrCreateImportOperationKey>;
const clearActive = clearActiveImportIdIfMatches as jest.MockedFunction<typeof clearActiveImportIdIfMatches>;
const clearKeys = clearImportOperationKeys as jest.MockedFunction<typeof clearImportOperationKeys>;

const readyImport = (duplicate: NonNullable<ArticleImportDto['preview']>['duplicate']): ArticleImportDto => ({
  id: '11111111-1111-4111-8111-111111111111',
  sourceKind: 'paste',
  status: 'preview_ready',
  createdAt: '2026-09-13T00:00:00.000Z',
  expiresAt: '2026-09-20T00:00:00.000Z',
  pollAfterMs: undefined,
  failure: null,
  preview: {
    title: 'Imported article',
    text: 'This is a valid imported article with enough English words.',
    wordCount: 20,
    duplicate,
  },
  articleId: null,
});

beforeEach(() => jest.clearAllMocks());

it('opens a similar existing article and clears its draft state', async () => {
  confirm.mockResolvedValue({
    ...readyImport({ kind: 'none' }),
    status: 'confirmed',
    preview: null,
    articleId: '22222222-2222-4222-8222-222222222222',
  });

  await expect(autoConfirmArticleImport(readyImport({
    kind: 'similar',
    article: {
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Existing article',
      wordCount: 21,
      hammingDistance: 2,
    },
  }))).resolves.toBe('22222222-2222-4222-8222-222222222222');

  expect(loadKey).toHaveBeenCalledWith(
    '11111111-1111-4111-8111-111111111111',
    'confirm',
  );
  expect(confirm).toHaveBeenCalledWith(
    '11111111-1111-4111-8111-111111111111',
    { similarityDecision: 'open_existing' },
    'confirm-key',
  );
  expect(clearKeys).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  expect(clearActive).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
});

it('uses an empty confirmation request when there is no similar duplicate', async () => {
  confirm.mockResolvedValue({
    ...readyImport({ kind: 'none' }),
    status: 'confirmed',
    preview: null,
    articleId: '22222222-2222-4222-8222-222222222222',
  });

  await autoConfirmArticleImport(readyImport({ kind: 'none' }));

  expect(confirm).toHaveBeenCalledWith(
    '11111111-1111-4111-8111-111111111111',
    {},
    'confirm-key',
  );
});
